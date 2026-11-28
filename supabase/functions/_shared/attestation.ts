import type { UpstashRedisClient } from "./redis.ts";
import { canonicalizeAttestationPayload, type AttestationPayload } from "./validation.ts";

export type AttestationMode = "enforce" | "dev_bypass";

export type StoredAppleAttestKey = {
  publicKeySpkiBase64: string;
  signCount: number;
};

export type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export type AttestationDeps = {
  redis: UpstashRedisClient;
  mode: AttestationMode;
  appleAppId?: string;
  googlePackageName?: string;
  googleServiceAccountJson?: string;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
};

export type AttestationResult =
  | { ok: true; mode: AttestationMode }
  | { ok: false; status: 403 | 503; error: string; message: string };

export async function sha256Bytes(input: Uint8Array | string): Promise<Uint8Array> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return new Uint8Array(digest);
}

export async function sha256Hex(input: Uint8Array | string): Promise<string> {
  const bytes = await sha256Bytes(input);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64ToBytes(raw: string): Uint8Array {
  const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLen);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

export function constantTimeEqualStrings(a: string, b: string): boolean {
  const enc = new TextEncoder();
  return constantTimeEqual(enc.encode(a), enc.encode(b));
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

type CborValue = string | Uint8Array | number | Map<string, CborValue>;

function readCborLength(bytes: Uint8Array, pos: number, additional: number): [number, number] {
  if (additional < 24) {
    return [additional, pos];
  }
  if (additional === 24) {
    if (pos + 1 > bytes.length) throw new Error("CBOR truncated");
    return [bytes[pos] ?? 0, pos + 1];
  }
  if (additional === 25) {
    if (pos + 2 > bytes.length) throw new Error("CBOR truncated");
    const val = ((bytes[pos] ?? 0) << 8) | (bytes[pos + 1] ?? 0);
    return [val, pos + 2];
  }
  if (additional === 26) {
    if (pos + 4 > bytes.length) throw new Error("CBOR truncated");
    const view = new DataView(bytes.buffer, bytes.byteOffset + pos, 4);
    return [view.getUint32(0, false), pos + 4];
  }
  throw new Error("Unsupported CBOR length");
}

function decodeCborItem(bytes: Uint8Array, offset: number): [CborValue, number] {
  if (offset >= bytes.length) {
    throw new Error("CBOR unexpected EOF");
  }
  const initial = bytes[offset] ?? 0;
  const major = initial >> 5;
  const additional = initial & 0x1f;
  let pos = offset + 1;

  if (major === 0) {
    const [val, next] = readCborLength(bytes, pos, additional);
    return [val, next];
  }
  if (major === 2) {
    const [len, next] = readCborLength(bytes, pos, additional);
    if (next + len > bytes.length) throw new Error("CBOR byte string truncated");
    return [bytes.slice(next, next + len), next + len];
  }
  if (major === 3) {
    const [len, next] = readCborLength(bytes, pos, additional);
    if (next + len > bytes.length) throw new Error("CBOR text string truncated");
    const text = new TextDecoder().decode(bytes.slice(next, next + len));
    return [text, next + len];
  }
  if (major === 5) {
    const [count, nextStart] = readCborLength(bytes, pos, additional);
    pos = nextStart;
    const map = new Map<string, CborValue>();
    for (let i = 0; i < count; i++) {
      const [key, afterKey] = decodeCborItem(bytes, pos);
      const [val, afterVal] = decodeCborItem(bytes, afterKey);
      if (typeof key !== "string") {
        throw new Error("CBOR map key must be text");
      }
      map.set(key, val);
      pos = afterVal;
    }
    return [map, pos];
  }
  throw new Error(`Unsupported CBOR major type ${major}`);
}

export function decodeAppleAssertionCbor(tokenBytes: Uint8Array): {
  authenticatorData: Uint8Array;
  signature: Uint8Array;
} {
  const [decoded, endOffset] = decodeCborItem(tokenBytes, 0);
  if (endOffset !== tokenBytes.length || !(decoded instanceof Map)) {
    throw new Error("Invalid Apple assertion CBOR structure");
  }
  const authenticatorData = decoded.get("authenticatorData");
  const signature = decoded.get("signature");
  if (!(authenticatorData instanceof Uint8Array) || !(signature instanceof Uint8Array)) {
    throw new Error("Missing authenticatorData or signature in assertion");
  }
  return { authenticatorData, signature };
}

/**
 * Converts an ASN.1 DER-encoded ECDSA P-256 signature to raw 64-byte (r || s)
 * format required by WebCrypto SubtleCrypto.verify.
 */
export function derEcdsaToRawP256(der: Uint8Array): Uint8Array | null {
  if (der.length < 8 || der[0] !== 0x30) {
    return null;
  }
  let pos = 2;
  if ((der[1] ?? 0) & 0x80) {
    const lenBytes = (der[1] ?? 0) & 0x7f;
    pos = 2 + lenBytes;
  }
  if (pos >= der.length || der[pos] !== 0x02) {
    return null;
  }
  const rLen = der[pos + 1] ?? 0;
  const rStart = pos + 2;
  const rEnd = rStart + rLen;
  if (rEnd >= der.length || der[rEnd] !== 0x02) {
    return null;
  }
  const sLen = der[rEnd + 1] ?? 0;
  const sStart = rEnd + 2;
  const sEnd = sStart + sLen;
  if (sEnd !== der.length) {
    return null;
  }

  const rBytes = der.slice(rStart, rEnd);
  const sBytes = der.slice(sStart, sEnd);

  const normalizeScalar = (scalar: Uint8Array): Uint8Array | null => {
    let start = 0;
    while (start < scalar.length - 1 && scalar[start] === 0) {
      start++;
    }
    const trimmed = scalar.slice(start);
    if (trimmed.length > 32) {
      return null;
    }
    const out = new Uint8Array(32);
    out.set(trimmed, 32 - trimmed.length);
    return out;
  };

  const rNorm = normalizeScalar(rBytes);
  const sNorm = normalizeScalar(sBytes);
  if (!rNorm || !sNorm) {
    return null;
  }

  return concatBytes(rNorm, sNorm);
}

async function verifyAppleAppAttest(
  userId: string,
  attestation: AttestationPayload,
  deps: AttestationDeps,
): Promise<AttestationResult> {
  if (!deps.appleAppId || !attestation.keyId) {
    return {
      ok: false,
      status: 403,
      error: "attestation_failed",
      message: "Device attestation verification failed.",
    };
  }

  const redisKey = `app_attest_key:${userId}:${attestation.keyId}`;
  const storedRaw = await deps.redis.get(redisKey);
  if (!storedRaw) {
    return {
      ok: false,
      status: 403,
      error: "attestation_key_unknown",
      message: "Device attestation key is not registered.",
    };
  }

  let stored: StoredAppleAttestKey;
  try {
    stored = JSON.parse(storedRaw) as StoredAppleAttestKey;
    if (typeof stored.publicKeySpkiBase64 !== "string" || typeof stored.signCount !== "number") {
      throw new Error("Invalid key record");
    }
  } catch {
    return {
      ok: false,
      status: 403,
      error: "attestation_failed",
      message: "Device attestation verification failed.",
    };
  }

  try {
    const assertionBytes = base64ToBytes(attestation.token);
    const { authenticatorData, signature } = decodeAppleAssertionCbor(assertionBytes);
    if (authenticatorData.length < 37) {
      return {
        ok: false,
        status: 403,
        error: "attestation_failed",
        message: "Device attestation verification failed.",
      };
    }

    const expectedRpIdHash = await sha256Bytes(deps.appleAppId);
    const actualRpIdHash = authenticatorData.slice(0, 32);
    if (!constantTimeEqual(actualRpIdHash, expectedRpIdHash)) {
      return {
        ok: false,
        status: 403,
        error: "attestation_failed",
        message: "Device attestation verification failed.",
      };
    }

    const signCountView = new DataView(
      authenticatorData.buffer,
      authenticatorData.byteOffset + 33,
      4,
    );
    const signCount = signCountView.getUint32(0, false);
    if (signCount <= stored.signCount) {
      return {
        ok: false,
        status: 403,
        error: "attestation_replay",
        message: "Device attestation counter is stale.",
      };
    }

    const clientDataHash = await sha256Bytes(
      `${attestation.nonce}:${attestation.payloadHash.toLowerCase()}`,
    );
    const signedData = concatBytes(authenticatorData, clientDataHash);
    const rawSig = derEcdsaToRawP256(signature);
    if (!rawSig) {
      return {
        ok: false,
        status: 403,
        error: "attestation_failed",
        message: "Device attestation verification failed.",
      };
    }

    const spkiBytes = base64ToBytes(stored.publicKeySpkiBase64);
    const spkiCopy = new Uint8Array(spkiBytes.byteLength);
    spkiCopy.set(spkiBytes);
    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      spkiCopy.buffer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );

    const sigCopy = new Uint8Array(rawSig.byteLength);
    sigCopy.set(rawSig);
    const dataCopy = new Uint8Array(signedData.byteLength);
    dataCopy.set(signedData);

    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      cryptoKey,
      sigCopy.buffer,
      dataCopy.buffer,
    );

    if (!verified) {
      return {
        ok: false,
        status: 403,
        error: "attestation_failed",
        message: "Device attestation verification failed.",
      };
    }

    await deps.redis.setEx(
      redisKey,
      60 * 60 * 24 * 365,
      JSON.stringify({ publicKeySpkiBase64: stored.publicKeySpkiBase64, signCount }),
    );
    return { ok: true, mode: "enforce" };
  } catch {
    return {
      ok: false,
      status: 403,
      error: "attestation_failed",
      message: "Device attestation verification failed.",
    };
  }
}

function pemToDerBytes(pem: string): Uint8Array {
  const stripped = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  return base64ToBytes(stripped);
}

async function mintGoogleAccessToken(
  serviceAccount: GoogleServiceAccount,
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<string | null> {
  const tokenUri = serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token";
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + 3600;
  const enc = new TextEncoder();

  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claimB64 = base64UrlEncode(
    enc.encode(
      JSON.stringify({
        iss: serviceAccount.client_email,
        scope: "https://www.googleapis.com/auth/playintegrity",
        aud: tokenUri,
        iat,
        exp,
      }),
    ),
  );
  const signingInput = `${headerB64}.${claimB64}`;

  const keyDer = pemToDerBytes(serviceAccount.private_key);
  const keyCopy = new Uint8Array(keyDer.byteLength);
  keyCopy.set(keyDer);
  const rsaKey = await crypto.subtle.importKey(
    "pkcs8",
    keyCopy.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", rsaKey, enc.encode(signingInput));
  const jwt = `${signingInput}.${base64UrlEncode(new Uint8Array(sigBuf))}`;

  const res = await fetchImpl(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    return null;
  }
  const json = (await res.json()) as { access_token?: unknown };
  return typeof json.access_token === "string" ? json.access_token : null;
}

async function verifyGooglePlayIntegrity(
  attestation: AttestationPayload,
  deps: AttestationDeps,
): Promise<AttestationResult> {
  if (!deps.googlePackageName || !deps.googleServiceAccountJson) {
    return {
      ok: false,
      status: 403,
      error: "attestation_failed",
      message: "Device attestation verification failed.",
    };
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowMs = (deps.nowMs ?? Date.now)();

  let serviceAccount: GoogleServiceAccount;
  try {
    serviceAccount = JSON.parse(deps.googleServiceAccountJson) as GoogleServiceAccount;
    if (!serviceAccount.client_email || !serviceAccount.private_key) {
      throw new Error("Invalid service account JSON");
    }
  } catch {
    return {
      ok: false,
      status: 403,
      error: "attestation_failed",
      message: "Device attestation verification failed.",
    };
  }

  try {
    const accessToken = await mintGoogleAccessToken(serviceAccount, fetchImpl, nowMs);
    if (!accessToken) {
      return {
        ok: false,
        status: 503,
        error: "attestation_unavailable",
        message: "Unable to verify device integrity right now.",
      };
    }

    const decodeRes = await fetchImpl(
      `https://playintegrity.googleapis.com/v1/${encodeURIComponent(deps.googlePackageName)}:decodeIntegrityToken`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ integrityToken: attestation.token }),
      },
    );

    if (!decodeRes.ok) {
      return {
        ok: false,
        status: 403,
        error: "attestation_failed",
        message: "Device attestation verification failed.",
      };
    }

    const payload = (await decodeRes.json()) as {
      tokenPayloadExternal?: {
        requestDetails?: {
          requestPackageName?: string;
          nonce?: string;
        };
        appIntegrity?: {
          appRecognitionVerdict?: string;
        };
        deviceIntegrity?: {
          deviceRecognitionVerdict?: string[];
        };
      };
    };

    const details = payload.tokenPayloadExternal;
    const expectedNonce = base64UrlEncode(
      await sha256Bytes(`${attestation.nonce}:${attestation.payloadHash.toLowerCase()}`),
    );
    const pkgMatch = details?.requestDetails?.requestPackageName === deps.googlePackageName;
    const nonceMatch =
      typeof details?.requestDetails?.nonce === "string" &&
      constantTimeEqualStrings(details.requestDetails.nonce, expectedNonce);
    const appRecognized = details?.appIntegrity?.appRecognitionVerdict === "PLAY_RECOGNIZED";
    const deviceMeetsIntegrity =
      Array.isArray(details?.deviceIntegrity?.deviceRecognitionVerdict) &&
      details.deviceIntegrity.deviceRecognitionVerdict.includes("MEETS_DEVICE_INTEGRITY");

    if (!pkgMatch || !nonceMatch || !appRecognized || !deviceMeetsIntegrity) {
      return {
        ok: false,
        status: 403,
        error: "attestation_failed",
        message: "Device attestation verification failed.",
      };
    }

    return { ok: true, mode: "enforce" };
  } catch {
    return {
      ok: false,
      status: 403,
      error: "attestation_failed",
      message: "Device attestation verification failed.",
    };
  }
}

/**
 * Verifies payload integrity hash, atomically consumes the single-use 60s nonce,
 * and validates Apple App Attest or Google Play Integrity when mode === "enforce".
 */
export async function verifyRequestAttestation(params: {
  userId: string;
  attestation: AttestationPayload;
  requestPayloadWithoutAttestation: unknown;
  deps: AttestationDeps;
}): Promise<AttestationResult> {
  const { userId, attestation, requestPayloadWithoutAttestation, deps } = params;

  const expectedHash = await sha256Hex(
    canonicalizeAttestationPayload(requestPayloadWithoutAttestation),
  );
  if (!constantTimeEqualStrings(attestation.payloadHash.toLowerCase(), expectedHash)) {
    return {
      ok: false,
      status: 403,
      error: "payload_hash_mismatch",
      message: "Request signature did not match payload.",
    };
  }

  const nonceKey = `auth_nonce:${userId}:${attestation.nonce}`;
  let consumed: string | null;
  try {
    consumed = await deps.redis.getDel(nonceKey);
  } catch {
    return {
      ok: false,
      status: 503,
      error: "attestation_unavailable",
      message: "Unable to verify challenge nonce right now.",
    };
  }

  if (!consumed) {
    return {
      ok: false,
      status: 403,
      error: "invalid_or_expired_nonce",
      message: "Challenge nonce is missing, expired, or already used.",
    };
  }

  if (deps.mode === "dev_bypass") {
    return { ok: true, mode: "dev_bypass" };
  }

  if (attestation.platform === "ios") {
    return verifyAppleAppAttest(userId, attestation, deps);
  }
  return verifyGooglePlayIntegrity(attestation, deps);
}
