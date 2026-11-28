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
  appleEnvironment?: "production" | "sandbox";
  appleRootCaDerBase64?: string;
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

type CborValue = string | Uint8Array | number | CborValue[] | Map<string | number, CborValue>;

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
  if (major === 1) {
    const [val, next] = readCborLength(bytes, pos, additional);
    return [-1 - val, next];
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
  if (major === 4) {
    const [count, nextStart] = readCborLength(bytes, pos, additional);
    pos = nextStart;
    const arr: CborValue[] = [];
    for (let i = 0; i < count; i++) {
      const [item, afterItem] = decodeCborItem(bytes, pos);
      arr.push(item);
      pos = afterItem;
    }
    return [arr, pos];
  }
  if (major === 5) {
    const [count, nextStart] = readCborLength(bytes, pos, additional);
    pos = nextStart;
    const map = new Map<string | number, CborValue>();
    for (let i = 0; i < count; i++) {
      const [key, afterKey] = decodeCborItem(bytes, pos);
      const [val, afterVal] = decodeCborItem(bytes, afterKey);
      if (typeof key !== "string" && typeof key !== "number") {
        throw new Error("CBOR map key must be text or integer");
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

    let advanced: boolean;
    try {
      advanced = await deps.redis.compareAndAdvanceCounter(redisKey, signCount, 60 * 60 * 24 * 365);
    } catch {
      return {
        ok: false,
        status: 503,
        error: "attestation_unavailable",
        message: "Unable to verify device attestation counter right now.",
      };
    }
    if (!advanced) {
      return {
        ok: false,
        status: 403,
        error: "attestation_replay",
        message: "Device attestation counter is stale.",
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

function pemToDerBytes(pem: string): Uint8Array {
  const stripped = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  return base64ToBytes(stripped);
}

const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const APPLE_ATTEST_OID_BYTES = new Uint8Array([
  0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02,
]);
const APPLE_PRODUCTION_AAGUID = new TextEncoder().encode("appattest\0\0\0\0\0\0\0");
const APPLE_SANDBOX_AAGUID = new TextEncoder().encode("appattestdevelop");

// Official Apple App Attestation Root CA (https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem)
const APPLE_APP_ATTESTATION_ROOT_CA_DER_BASE64 =
  "MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw" +
  "JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK" +
  "QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa" +
  "Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv" +
  "biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y" +
  "bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh" +
  "NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au" +
  "Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/" +
  "MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw" +
  "CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn" +
  "53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV" +
  "oyFraWVIyd/dganmrduC1bmTBGwD";

// ECDSA OIDs
const OID_ECDSA_SHA256 = new Uint8Array([
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02,
]);
const OID_ECDSA_SHA384 = new Uint8Array([
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x03,
]);
const OID_P256 = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
const OID_P384 = new Uint8Array([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22]);

type DerTlv = {
  tag: number;
  headerLen: number;
  valueStart: number;
  valueEnd: number;
  totalEnd: number;
};

function readDerTlv(bytes: Uint8Array, offset: number): DerTlv {
  if (offset >= bytes.length) {
    throw new Error("DER unexpected EOF");
  }
  const tag = bytes[offset] ?? 0;
  let pos = offset + 1;
  if (pos >= bytes.length) {
    throw new Error("DER missing length");
  }
  const lenByte = bytes[pos++] ?? 0;
  let valueLen = 0;
  if ((lenByte & 0x80) === 0) {
    valueLen = lenByte;
  } else {
    const numOctets = lenByte & 0x7f;
    if (numOctets === 0 || numOctets > 4 || pos + numOctets > bytes.length) {
      throw new Error("DER invalid length");
    }
    for (let i = 0; i < numOctets; i++) {
      valueLen = (valueLen << 8) | (bytes[pos++] ?? 0);
    }
  }
  const valueEnd = pos + valueLen;
  if (valueEnd > bytes.length) {
    throw new Error("DER value truncated");
  }
  return { tag, headerLen: pos - offset, valueStart: pos, valueEnd, totalEnd: valueEnd };
}

function readDerChildren(bytes: Uint8Array, start: number, end: number): DerTlv[] {
  const children: DerTlv[] = [];
  let pos = start;
  while (pos < end) {
    const child = readDerTlv(bytes, pos);
    children.push(child);
    pos = child.totalEnd;
  }
  if (pos !== end) {
    throw new Error("DER container length mismatch");
  }
  return children;
}

function parseAsn1TimeMs(bytes: Uint8Array, tlv: DerTlv): number {
  const raw = new TextDecoder().decode(bytes.slice(tlv.valueStart, tlv.valueEnd));
  if (tlv.tag === 0x17) {
    // UTCTime: YYMMDDHHMMSSZ
    const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(raw);
    if (!m) throw new Error("Invalid UTCTime");
    const yy = Number.parseInt(m[1]!, 10);
    const year = yy >= 50 ? 1900 + yy : 2000 + yy;
    return Date.UTC(
      year,
      Number.parseInt(m[2]!, 10) - 1,
      Number.parseInt(m[3]!, 10),
      Number.parseInt(m[4]!, 10),
      Number.parseInt(m[5]!, 10),
      Number.parseInt(m[6]!, 10),
    );
  }
  if (tlv.tag === 0x18) {
    // GeneralizedTime: YYYYMMDDHHMMSSZ
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(raw);
    if (!m) throw new Error("Invalid GeneralizedTime");
    return Date.UTC(
      Number.parseInt(m[1]!, 10),
      Number.parseInt(m[2]!, 10) - 1,
      Number.parseInt(m[3]!, 10),
      Number.parseInt(m[4]!, 10),
      Number.parseInt(m[5]!, 10),
      Number.parseInt(m[6]!, 10),
    );
  }
  throw new Error("Unsupported ASN.1 time tag");
}

function derEcdsaToRaw(der: Uint8Array, coordSize: 32 | 48): Uint8Array {
  if (der.length < 8 || der[0] !== 0x30) {
    throw new Error("Invalid DER ECDSA signature");
  }
  const seq = readDerTlv(der, 0);
  const ints = readDerChildren(der, seq.valueStart, seq.valueEnd);
  if (ints.length !== 2 || ints[0]!.tag !== 0x02 || ints[1]!.tag !== 0x02) {
    throw new Error("Invalid DER ECDSA integers");
  }
  const norm = (tlv: DerTlv): Uint8Array => {
    const slice = der.slice(tlv.valueStart, tlv.valueEnd);
    let start = 0;
    while (start < slice.length - 1 && slice[start] === 0) {
      start++;
    }
    const trimmed = slice.slice(start);
    if (trimmed.length > coordSize) {
      throw new Error("ECDSA scalar too large");
    }
    const out = new Uint8Array(coordSize);
    out.set(trimmed, coordSize - trimmed.length);
    return out;
  };
  return concatBytes(norm(ints[0]!), norm(ints[1]!));
}

type ParsedX509Cert = {
  der: Uint8Array;
  tbsBytes: Uint8Array;
  sigHash: "SHA-256" | "SHA-384";
  sigDerBytes: Uint8Array;
  notBeforeMs: number;
  notAfterMs: number;
  spkiBytes: Uint8Array;
  ecCurve: "P-256" | "P-384";
};

function parseX509Certificate(der: Uint8Array): ParsedX509Cert {
  const root = readDerTlv(der, 0);
  if (root.tag !== 0x30 || root.totalEnd !== der.length) {
    throw new Error("Invalid X.509 certificate");
  }
  const top = readDerChildren(der, root.valueStart, root.valueEnd);
  if (top.length !== 3) {
    throw new Error("Invalid X.509 top-level structure");
  }
  const tbsTlv = top[0]!;
  const sigAlgTlv = top[1]!;
  const sigBitsTlv = top[2]!;
  if (tbsTlv.tag !== 0x30 || sigAlgTlv.tag !== 0x30 || sigBitsTlv.tag !== 0x03) {
    throw new Error("Invalid X.509 certificate fields");
  }

  const tbsBytes = der.slice(root.valueStart, tbsTlv.totalEnd);
  const sigAlgSlice = der.slice(sigAlgTlv.valueStart, sigAlgTlv.valueEnd);
  let sigHash: "SHA-256" | "SHA-384";
  if (findByteSubsequence(sigAlgSlice, OID_ECDSA_SHA256) !== -1) {
    sigHash = "SHA-256";
  } else if (findByteSubsequence(sigAlgSlice, OID_ECDSA_SHA384) !== -1) {
    sigHash = "SHA-384";
  } else {
    throw new Error("Unsupported X.509 signature algorithm");
  }

  if (der[sigBitsTlv.valueStart] !== 0x00) {
    throw new Error("Invalid X.509 signature bitstring");
  }
  const sigDerBytes = der.slice(sigBitsTlv.valueStart + 1, sigBitsTlv.valueEnd);

  const tbsChildren = readDerChildren(der, tbsTlv.valueStart, tbsTlv.valueEnd);
  let idx = 0;
  if (tbsChildren[0]?.tag === 0xa0) {
    idx = 1; // optional version [0]
  }
  // serialNumber(idx), signature(idx+1), issuer(idx+2), validity(idx+3), subject(idx+4), spki(idx+5)
  const validityTlv = tbsChildren[idx + 3];
  const spkiTlv = tbsChildren[idx + 5];
  if (!validityTlv || validityTlv.tag !== 0x30 || !spkiTlv || spkiTlv.tag !== 0x30) {
    throw new Error("Missing X.509 validity or SPKI");
  }
  const validityChildren = readDerChildren(der, validityTlv.valueStart, validityTlv.valueEnd);
  if (validityChildren.length !== 2) {
    throw new Error("Invalid X.509 validity");
  }
  const notBeforeMs = parseAsn1TimeMs(der, validityChildren[0]!);
  const notAfterMs = parseAsn1TimeMs(der, validityChildren[1]!);

  const spkiBytes = der.slice(spkiTlv.valueStart - spkiTlv.headerLen, spkiTlv.totalEnd);
  let ecCurve: "P-256" | "P-384";
  if (findByteSubsequence(spkiBytes, OID_P256) !== -1) {
    ecCurve = "P-256";
  } else if (findByteSubsequence(spkiBytes, OID_P384) !== -1) {
    ecCurve = "P-384";
  } else {
    throw new Error("Unsupported X.509 EC curve");
  }

  return {
    der,
    tbsBytes,
    sigHash,
    sigDerBytes,
    notBeforeMs,
    notAfterMs,
    spkiBytes,
    ecCurve,
  };
}

async function verifyCertSignedBy(child: ParsedX509Cert, issuer: ParsedX509Cert): Promise<boolean> {
  const spkiCopy = new Uint8Array(issuer.spkiBytes.byteLength);
  spkiCopy.set(issuer.spkiBytes);
  const issuerKey = await crypto.subtle.importKey(
    "spki",
    spkiCopy.buffer,
    { name: "ECDSA", namedCurve: issuer.ecCurve },
    false,
    ["verify"],
  );
  const coordSize: 32 | 48 = issuer.ecCurve === "P-384" ? 48 : 32;
  const rawSig = derEcdsaToRaw(child.sigDerBytes, coordSize);
  const sigCopy = new Uint8Array(rawSig.byteLength);
  sigCopy.set(rawSig);
  const tbsCopy = new Uint8Array(child.tbsBytes.byteLength);
  tbsCopy.set(child.tbsBytes);

  return crypto.subtle.verify(
    { name: "ECDSA", hash: child.sigHash },
    issuerKey,
    sigCopy.buffer,
    tbsCopy.buffer,
  );
}

async function verifyX509ChainAgainstRoot(params: {
  x5c: Uint8Array[];
  rootCaDer: Uint8Array;
  nowMs: number;
}): Promise<ParsedX509Cert> {
  const { x5c, rootCaDer, nowMs } = params;
  if (x5c.length < 2) {
    throw new Error("x5c chain must contain at least leaf and intermediate certificates");
  }

  const rootCert = parseX509Certificate(rootCaDer);
  if (nowMs < rootCert.notBeforeMs || nowMs > rootCert.notAfterMs) {
    throw new Error("Root CA expired or not yet valid");
  }

  const certs = x5c.map((der) => parseX509Certificate(der));
  for (const cert of certs) {
    if (nowMs < cert.notBeforeMs || nowMs > cert.notAfterMs) {
      throw new Error("Certificate expired or not yet valid");
    }
  }

  for (let i = 0; i < certs.length - 1; i++) {
    const ok = await verifyCertSignedBy(certs[i]!, certs[i + 1]!);
    if (!ok) {
      throw new Error("x5c intermediate signature verification failed");
    }
  }

  const last = certs[certs.length - 1]!;
  if (!constantTimeEqual(last.der, rootCert.der)) {
    const signedByRoot = await verifyCertSignedBy(last, rootCert);
    if (!signedByRoot) {
      throw new Error("x5c chain does not terminate at trusted Apple Root CA");
    }
  }

  return certs[0]!;
}

function findByteSubsequence(haystack: Uint8Array, needle: Uint8Array, start = 0): number {
  outer: for (let i = start; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

/**
 * Enrolls an Apple App Attest keypair after validating the attestationObject
 * (format, Apple Root CA x5c chain, AAGUID environment, RP ID hash, signCount === 0,
 * credentialId === SHA-256(publicKey), leaf cert SPKI binding, and extension nonce)
 * and stores it atomically with SET NX.
 */
export async function registerAppleAppAttestKey(params: {
  userId: string;
  keyId: string;
  attestationObjectBase64: string;
  nonce: string;
  deps: AttestationDeps;
}): Promise<{ ok: true } | { ok: false; status: 403 | 409 | 503; error: string; message: string }> {
  const { userId, keyId, attestationObjectBase64, nonce, deps } = params;

  const nonceKey = `auth_nonce:${userId}:${nonce}`;
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

  if (!deps.appleAppId) {
    return {
      ok: false,
      status: 403,
      error: "attestation_failed",
      message: "Device attestation verification failed.",
    };
  }

  let spkiBase64: string;
  try {
    const attBytes = base64ToBytes(attestationObjectBase64);
    const [decoded, endOffset] = decodeCborItem(attBytes, 0);
    if (endOffset !== attBytes.length || !(decoded instanceof Map)) {
      throw new Error("Invalid attestationObject CBOR");
    }

    const fmt = decoded.get("fmt");
    const attStmt = decoded.get("attStmt");
    const authData = decoded.get("authData");
    if (
      fmt !== "apple-appattest" ||
      !(attStmt instanceof Map) ||
      !(authData instanceof Uint8Array) ||
      authData.length < 55
    ) {
      throw new Error("Invalid Apple attestation fields");
    }

    const rawX5c = attStmt.get("x5c");
    if (
      !Array.isArray(rawX5c) ||
      rawX5c.length < 2 ||
      !rawX5c.every((item): item is Uint8Array => item instanceof Uint8Array)
    ) {
      throw new Error("Invalid x5c certificate chain");
    }

    const rootCaDer = base64ToBytes(
      deps.appleRootCaDerBase64 ?? APPLE_APP_ATTESTATION_ROOT_CA_DER_BASE64,
    );
    const leafCert = await verifyX509ChainAgainstRoot({
      x5c: rawX5c,
      rootCaDer,
      nowMs: (deps.nowMs ?? Date.now)(),
    });

    const expectedRpIdHash = await sha256Bytes(deps.appleAppId);
    if (!constantTimeEqual(authData.slice(0, 32), expectedRpIdHash)) {
      throw new Error("RP ID hash mismatch");
    }

    const signCount = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(
      0,
      false,
    );
    if (signCount !== 0) {
      throw new Error("Initial signCount must be 0");
    }

    const expectedAaguid =
      deps.appleEnvironment === "sandbox" ? APPLE_SANDBOX_AAGUID : APPLE_PRODUCTION_AAGUID;
    if (!constantTimeEqual(authData.slice(37, 53), expectedAaguid)) {
      throw new Error("App Attest environment AAGUID mismatch");
    }

    const credIdLen = new DataView(authData.buffer, authData.byteOffset + 53, 2).getUint16(
      0,
      false,
    );
    const credIdEnd = 55 + credIdLen;
    if (credIdLen !== 32 || credIdEnd >= authData.length) {
      throw new Error("Invalid credentialId length");
    }
    const credId = authData.slice(55, credIdEnd);
    const keyIdBytes = base64ToBytes(keyId);
    if (!constantTimeEqual(credId, keyIdBytes)) {
      throw new Error("keyId does not match credentialId");
    }

    const [coseKey] = decodeCborItem(authData, credIdEnd);
    if (!(coseKey instanceof Map)) {
      throw new Error("Invalid COSE key");
    }
    const kty = coseKey.get(1);
    const crv = coseKey.get(-1);
    const xCoord = coseKey.get(-2);
    const yCoord = coseKey.get(-3);
    if (
      kty !== 2 ||
      crv !== 1 ||
      !(xCoord instanceof Uint8Array) ||
      !(yCoord instanceof Uint8Array) ||
      xCoord.length !== 32 ||
      yCoord.length !== 32
    ) {
      throw new Error("Unsupported COSE key parameters");
    }

    const rawUncompressed = new Uint8Array(65);
    rawUncompressed[0] = 0x04;
    rawUncompressed.set(xCoord, 1);
    rawUncompressed.set(yCoord, 33);

    const pubKeyHash = await sha256Bytes(rawUncompressed);
    if (!constantTimeEqual(pubKeyHash, credId)) {
      throw new Error("Credential ID does not match public key hash");
    }

    const clientDataHash = await sha256Bytes(nonce);
    const expectedCertNonce = await sha256Bytes(concatBytes(authData, clientDataHash));
    const oidIndex = findByteSubsequence(leafCert.der, APPLE_ATTEST_OID_BYTES);
    if (oidIndex === -1) {
      throw new Error("Missing Apple App Attest extension OID");
    }
    const nonceMarker = concatBytes(new Uint8Array([0x04, 0x20]), expectedCertNonce);
    const nonceIndex = findByteSubsequence(leafCert.der, nonceMarker, oidIndex);
    if (nonceIndex === -1) {
      throw new Error("Leaf certificate nonce mismatch");
    }

    const imported = await crypto.subtle.importKey(
      "raw",
      rawUncompressed,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["verify"],
    );
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", imported));
    if (!constantTimeEqual(leafCert.spkiBytes, spki)) {
      throw new Error("Leaf certificate SPKI does not match credential public key");
    }
    spkiBase64 = bytesToBase64(spki);
  } catch {
    return {
      ok: false,
      status: 403,
      error: "attestation_failed",
      message: "Device attestation key enrollment failed.",
    };
  }

  const redisKey = `app_attest_key:${userId}:${keyId}`;
  let stored: boolean;
  try {
    stored = await deps.redis.setNxEx(
      redisKey,
      60 * 60 * 24 * 365,
      JSON.stringify({ publicKeySpkiBase64: spkiBase64, signCount: 0 }),
    );
  } catch {
    return {
      ok: false,
      status: 503,
      error: "attestation_unavailable",
      message: "Unable to store device attestation key right now. Please restart enrollment.",
    };
  }

  if (!stored) {
    return {
      ok: false,
      status: 409,
      error: "attestation_key_already_registered",
      message: "Device attestation key is already registered.",
    };
  }

  return { ok: true };
}

async function mintGoogleAccessToken(
  serviceAccount: GoogleServiceAccount,
  fetchImpl: typeof fetch,
  nowMs: number,
): Promise<string | null> {
  if (serviceAccount.token_uri && serviceAccount.token_uri !== GOOGLE_OAUTH_TOKEN_URL) {
    throw new Error("Invalid Google service account token_uri");
  }
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + 3600;
  const enc = new TextEncoder();

  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claimB64 = base64UrlEncode(
    enc.encode(
      JSON.stringify({
        iss: serviceAccount.client_email,
        scope: "https://www.googleapis.com/auth/playintegrity",
        aud: GOOGLE_OAUTH_TOKEN_URL,
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

  const res = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    redirect: "error",
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
    if (serviceAccount.token_uri && serviceAccount.token_uri !== GOOGLE_OAUTH_TOKEN_URL) {
      throw new Error("Invalid token_uri");
    }
  } catch {
    return {
      ok: false,
      status: 403,
      error: "attestation_failed",
      message: "Device attestation verification failed.",
    };
  }

  let decodeRes: Response;
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

    decodeRes = await fetchImpl(
      `https://playintegrity.googleapis.com/v1/${encodeURIComponent(deps.googlePackageName)}:decodeIntegrityToken`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ integrityToken: attestation.token }),
      },
    );
  } catch {
    return {
      ok: false,
      status: 503,
      error: "attestation_unavailable",
      message: "Unable to verify device integrity right now.",
    };
  }

  if (decodeRes.status >= 500 || decodeRes.status === 429) {
    return {
      ok: false,
      status: 503,
      error: "attestation_unavailable",
      message: "Unable to verify device integrity right now.",
    };
  }

  if (!decodeRes.ok) {
    return {
      ok: false,
      status: 403,
      error: "attestation_failed",
      message: "Device attestation verification failed.",
    };
  }

  try {
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
