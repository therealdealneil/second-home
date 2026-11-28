import { describe, expect, it } from "vitest";
import {
  base64UrlEncode,
  sha256Bytes,
  sha256Hex,
  type AttestationDeps,
} from "./_shared/attestation.ts";
import { parsePostgisPoint } from "./_shared/geo.ts";
import { parseJsonBody } from "./_shared/http.ts";
import { createUpstashRedisClient, type UpstashRedisClient } from "./_shared/redis.ts";
import type { AuthUser, EdgeDbAdapter, HouseholdRow, UserProfileRow } from "./_shared/supabase.ts";
import { canonicalizeAttestationPayload } from "./_shared/validation.ts";
import { createAuthChallengeHandler } from "./auth-challenge/handler.ts";
import { createCreateHouseholdHandler } from "./create-household/handler.ts";
import { createJoinHouseholdHandler } from "./join-household/handler.ts";
import { createSendConnectionRequestHandler } from "./send-connection-request/handler.ts";

function createInMemoryRedis(initialNowMs = 1_700_000_000_000): {
  client: UpstashRedisClient;
  store: Map<string, { value: string; expiresAtMs: number }>;
  setNow: (ms: number) => void;
} {
  let nowMs = initialNowMs;
  const store = new Map<string, { value: string; expiresAtMs: number }>();
  const windows = new Map<string, number[]>();

  const purgeExpired = (key: string) => {
    const entry = store.get(key);
    if (entry && entry.expiresAtMs <= nowMs) {
      store.delete(key);
    }
  };

  return {
    store,
    setNow: (ms: number) => {
      nowMs = ms;
    },
    client: {
      async get(key: string) {
        purgeExpired(key);
        return store.get(key)?.value ?? null;
      },
      async setEx(key: string, ttlSeconds: number, value: string) {
        store.set(key, { value, expiresAtMs: nowMs + ttlSeconds * 1000 });
      },
      async setNxEx(key: string, ttlSeconds: number, value: string) {
        purgeExpired(key);
        if (store.has(key)) {
          return false;
        }
        store.set(key, { value, expiresAtMs: nowMs + ttlSeconds * 1000 });
        return true;
      },
      async getDel(key: string) {
        purgeExpired(key);
        const existing = store.get(key);
        if (!existing) {
          return null;
        }
        store.delete(key);
        return existing.value;
      },
      async compareAndAdvanceCounter(key: string, newSignCount: number, ttlSeconds: number) {
        purgeExpired(key);
        const existing = store.get(key);
        if (!existing) {
          return false;
        }
        const parsed = JSON.parse(existing.value) as {
          publicKeySpkiBase64: string;
          signCount: number;
        };
        if (newSignCount <= parsed.signCount) {
          return false;
        }
        store.set(key, {
          value: JSON.stringify({ ...parsed, signCount: newSignCount }),
          expiresAtMs: nowMs + ttlSeconds * 1000,
        });
        return true;
      },
      async slidingWindowLimit(key: string, limit: number, windowSeconds: number, ts = nowMs) {
        const windowMs = windowSeconds * 1000;
        const cutoff = ts - windowMs;
        const hits = (windows.get(key) ?? []).filter((t) => t > cutoff);
        if (hits.length >= limit) {
          const oldest = hits[0] ?? ts;
          windows.set(key, hits);
          return { allowed: false, remaining: 0, resetAtMs: oldest + windowMs };
        }
        hits.push(ts);
        windows.set(key, hits);
        return { allowed: true, remaining: limit - hits.length, resetAtMs: ts + windowMs };
      },
    },
  };
}

function encodeEwkbPoint(lng: number, lat: number): string {
  const buf = new ArrayBuffer(25);
  const view = new DataView(buf);
  view.setUint8(0, 1); // little-endian
  view.setUint32(1, 0x2000_0001, true); // Point + SRID flag
  view.setUint32(5, 4326, true);
  view.setFloat64(9, lng, true);
  view.setFloat64(17, lat, true);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function rawP256ToDer(raw: Uint8Array): Uint8Array {
  const encodeInt = (slice: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < slice.length - 1 && slice[start] === 0) {
      start++;
    }
    const trimmed = slice.slice(start);
    const needsPad = (trimmed[0] ?? 0) >= 0x80;
    const out = new Uint8Array(2 + trimmed.length + (needsPad ? 1 : 0));
    out[0] = 0x02;
    out[1] = trimmed.length + (needsPad ? 1 : 0);
    if (needsPad) {
      out[2] = 0x00;
      out.set(trimmed, 3);
    } else {
      out.set(trimmed, 2);
    }
    return out;
  };
  const rDer = encodeInt(raw.slice(0, 32));
  const sDer = encodeInt(raw.slice(32, 64));
  const seq = new Uint8Array(2 + rDer.length + sDer.length);
  seq[0] = 0x30;
  seq[1] = rDer.length + sDer.length;
  seq.set(rDer, 2);
  seq.set(sDer, 2 + rDer.length);
  return seq;
}

function encodeAppleAssertionCbor(authenticatorData: Uint8Array, signature: Uint8Array): string {
  const enc = new TextEncoder();
  const cborBytes = (b: Uint8Array) => {
    const header =
      b.length < 24 ? new Uint8Array([0x40 | b.length]) : new Uint8Array([0x58, b.length]);
    const out = new Uint8Array(header.length + b.length);
    out.set(header, 0);
    out.set(b, header.length);
    return out;
  };
  const cborText = (t: string) => {
    const b = enc.encode(t);
    const out = new Uint8Array(1 + b.length);
    out[0] = 0x60 | b.length;
    out.set(b, 1);
    return out;
  };
  const parts = [
    new Uint8Array([0xa2]),
    cborText("authenticatorData"),
    cborBytes(authenticatorData),
    cborText("signature"),
    cborBytes(signature),
  ];
  const totalLen = parts.reduce((acc, p) => acc + p.length, 0);
  const full = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    full.set(p, offset);
    offset += p.length;
  }
  let binary = "";
  for (const b of full) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

async function createAppleAttestationFixture(params: {
  appleAppId: string;
  userId: string;
  keyId: string;
  nonce: string;
  payload: unknown;
  signCount: number;
  redis: UpstashRedisClient;
}) {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
  let spkiBin = "";
  for (const b of spki) spkiBin += String.fromCharCode(b);
  await params.redis.setEx(
    `app_attest_key:${params.userId}:${params.keyId}`,
    3600,
    JSON.stringify({ publicKeySpkiBase64: btoa(spkiBin), signCount: params.signCount - 1 }),
  );

  const payloadHash = await sha256Hex(canonicalizeAttestationPayload(params.payload));
  const rpIdHash = await sha256Bytes(params.appleAppId);
  const authData = new Uint8Array(37);
  authData.set(rpIdHash, 0);
  authData[32] = 0x01;
  new DataView(authData.buffer).setUint32(33, params.signCount, false);

  const clientDataHash = await sha256Bytes(`${params.nonce}:${payloadHash}`);
  const signedData = new Uint8Array(authData.length + clientDataHash.length);
  signedData.set(authData, 0);
  signedData.set(clientDataHash, authData.length);

  const rawSig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, signedData),
  );
  const derSig = rawP256ToDer(rawSig);
  const token = encodeAppleAssertionCbor(authData, derSig);

  return {
    platform: "ios" as const,
    nonce: params.nonce,
    token,
    keyId: params.keyId,
    payloadHash,
  };
}

function createInMemoryDb(authUsers: Record<string, AuthUser>): {
  db: EdgeDbAdapter;
  households: Map<string, HouseholdRow>;
  users: Map<string, UserProfileRow & { household_id: string }>;
  connections: Array<{
    id: string;
    requester_id: string;
    recipient_id: string;
    status: string;
    created_at: string;
  }>;
  failNextProfileInsert: { value: boolean };
} {
  const households = new Map<string, HouseholdRow>();
  const users = new Map<string, UserProfileRow & { household_id: string }>();
  const connections: Array<{
    id: string;
    requester_id: string;
    recipient_id: string;
    status: string;
    created_at: string;
  }> = [];
  const failNextProfileInsert = { value: false };
  let hhSeq = 1;
  let connSeq = 1;

  const locations = new Map([
    [
      "vadodara-alkapuri",
      {
        id: "vadodara-alkapuri",
        display_name: "Alkapuri, Vadodara, Gujarat",
        district: "Vadodara",
        lat: 22.3119,
        lng: 73.1723,
      },
    ],
    [
      "surat-vesu",
      {
        id: "surat-vesu",
        display_name: "Vesu, Surat, Gujarat",
        district: "Surat",
        lat: 21.1418,
        lng: 72.7709,
      },
    ],
  ]);

  const db: EdgeDbAdapter = {
    async getAuthUser(jwt: string) {
      return authUsers[jwt] ?? null;
    },
    async getUserProfile(userId: string) {
      return users.get(userId) ?? null;
    },
    async getGujaratLocation(locationId: string) {
      return locations.get(locationId) ?? null;
    },
    async createHouseholdWithAdmin(input) {
      if (failNextProfileInsert.value) {
        failNextProfileInsert.value = false;
        throw new Error("Simulated atomic creation failure");
      }
      if (users.has(input.userId)) {
        const err = new Error("duplicate") as Error & { code?: string };
        err.code = "23505";
        throw err;
      }
      const id = `00000000-0000-4000-8000-${String(hhSeq++).padStart(12, "0")}`;
      const row: HouseholdRow = {
        id,
        display_label: input.displayLabel,
        life_stage: input.lifeStage,
        exact_current_geog: encodeEwkbPoint(input.exactPoint.lng, input.exactPoint.lat),
        public_current_geog: encodeEwkbPoint(input.publicPoint.lng, input.publicPoint.lat),
        h3_index_res7: input.h3IndexRes7,
        neighborhood_name: input.neighborhoodName,
        invite_code: `invite_${hhSeq}`,
        is_verified_local: false,
      };
      households.set(id, row);
      users.set(input.userId, {
        id: input.userId,
        household_id: id,
        status: input.status,
        last_verified_at: input.lastVerifiedAt,
      });
      return {
        id: row.id,
        display_label: row.display_label,
        life_stage: row.life_stage,
        h3_index_res7: row.h3_index_res7,
        neighborhood_name: row.neighborhood_name,
        invite_code: row.invite_code,
        is_verified_local: row.is_verified_local,
      };
    },
    async createUserProfile(input) {
      if (failNextProfileInsert.value) {
        failNextProfileInsert.value = false;
        throw new Error("Simulated profile failure");
      }
      users.set(input.id, {
        id: input.id,
        household_id: input.householdId,
        status: input.status,
        last_verified_at: input.lastVerifiedAt,
      });
    },
    async getHouseholdByInviteCode(inviteCode: string) {
      for (const hh of households.values()) {
        if (hh.invite_code === inviteCode) {
          return hh;
        }
      }
      return null;
    },
    async getHouseholdExactPoint(householdId: string) {
      const hh = households.get(householdId);
      return hh ? parsePostgisPoint(hh.exact_current_geog) : null;
    },
    async isHouseholdVerifiedLocal(householdId: string) {
      return households.get(householdId)?.is_verified_local ?? false;
    },
    async hasBlockedConnectionWithHousehold(userId: string, targetHouseholdId: string) {
      const targetMemberIds = new Set(
        Array.from(users.values())
          .filter((u) => u.household_id === targetHouseholdId)
          .map((u) => u.id),
      );
      return connections.some(
        (c) =>
          c.status === "blocked" &&
          ((c.requester_id === userId && targetMemberIds.has(c.recipient_id)) ||
            (c.recipient_id === userId && targetMemberIds.has(c.requester_id))),
      );
    },
    async hasExistingActiveOrPendingConnection(userA: string, userB: string) {
      return connections.some(
        (c) =>
          (c.status === "pending" || c.status === "accepted") &&
          ((c.requester_id === userA && c.recipient_id === userB) ||
            (c.requester_id === userB && c.recipient_id === userA)),
      );
    },
    async createConnectionRequest(input) {
      const id = `00000000-0000-4000-9000-${String(connSeq++).padStart(12, "0")}`;
      const createdAt = "2026-11-28T10:00:00.000Z";
      connections.push({
        id,
        requester_id: input.requesterId,
        recipient_id: input.recipientId,
        status: "pending",
        created_at: createdAt,
      });
      return { id, createdAt };
    },
  };

  return { db, households, users, connections, failNextProfileInsert };
}

describe("parsePostgisPoint", () => {
  it("parses EWKB hex, WKT, and GeoJSON points", () => {
    const ewkb = encodeEwkbPoint(-98.5742, 29.5124);
    const parsedEwkb = parsePostgisPoint(ewkb);
    expect(parsedEwkb?.lat).toBeCloseTo(29.5124, 6);
    expect(parsedEwkb?.lng).toBeCloseTo(-98.5742, 6);

    expect(parsePostgisPoint("SRID=4326;POINT(-98.5742 29.5124)")).toEqual({
      lat: 29.5124,
      lng: -98.5742,
    });
    expect(parsePostgisPoint({ type: "Point", coordinates: [-98.5742, 29.5124] })).toEqual({
      lat: 29.5124,
      lng: -98.5742,
    });
  });
});

describe("Edge Function handlers", () => {
  const USER_A = "11111111-1111-4111-8111-111111111111";
  const USER_B = "22222222-2222-4222-8222-222222222222";
  const USER_NO_PHONE = "33333333-3333-4333-8333-333333333333";
  const APPLE_APP_ID = "TEAM123.app.secondhome.mobile";

  const authUsers: Record<string, AuthUser> = {
    "jwt-a": { id: USER_A, phone: "+12105550101" },
    "jwt-b": { id: USER_B, phone: "+12105550202" },
    "jwt-no-phone": { id: USER_NO_PHONE, phone: null },
  };

  it("issues single-use 60s challenge nonces via auth-challenge", async () => {
    const redis = createInMemoryRedis();
    const { db } = createInMemoryDb(authUsers);
    const handler = createAuthChallengeHandler({
      db,
      redis: redis.client,
      nowMs: () => 1_700_000_000_000,
    });

    const unauth = await handler(new Request("https://edge.local/auth-challenge"));
    expect(unauth.status).toBe(401);

    const res = await handler(
      new Request("https://edge.local/auth-challenge", {
        method: "GET",
        headers: { Authorization: "Bearer jwt-a" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nonce: string; expiresInSeconds: number };
    expect(body.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(body.expiresInSeconds).toBe(60);
    expect(await redis.client.get(`auth_nonce:${USER_A}:${body.nonce}`)).toBe("1");
  });

  it("creates household with Apple App Attest, enforces single-use nonce, and never leaks exact_current_geog or phone_e164", async () => {
    const redis = createInMemoryRedis();
    const { db } = createInMemoryDb(authUsers);
    const attestationDeps: AttestationDeps = {
      redis: redis.client,
      mode: "enforce",
      appleAppId: APPLE_APP_ID,
    };

    const challengeHandler = createAuthChallengeHandler({ db, redis: redis.client });
    const challengeRes = await challengeHandler(
      new Request("https://edge.local/auth-challenge", {
        headers: { Authorization: "Bearer jwt-a" },
      }),
    );
    const { nonce } = (await challengeRes.json()) as { nonce: string };

    const payloadWithoutAttestation = {
      gps: { lat: 29.5124, lng: -98.5742, accuracyMeters: 12, mocked: false },
      hometownLocationId: "vadodara-alkapuri",
      firstName: "Aarav",
      lifeStage: "family_young_kids",
    };

    const attestation = await createAppleAttestationFixture({
      appleAppId: APPLE_APP_ID,
      userId: USER_A,
      keyId: "device-key-1",
      nonce,
      payload: payloadWithoutAttestation,
      signCount: 1,
      redis: redis.client,
    });

    const createHandler = createCreateHouseholdHandler({
      db,
      redis: redis.client,
      attestation: attestationDeps,
      latLngToH3Res7: () => "874880102ffffff",
      rng: () => 0.37,
    });

    const res = await createHandler(
      new Request("https://edge.local/create-household", {
        method: "POST",
        headers: {
          Authorization: "Bearer jwt-a",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ attestation, ...payloadWithoutAttestation }),
      }),
    );

    expect(res.status).toBe(201);
    const rawText = await res.text();
    expect(rawText).not.toContain("exact_current_geog");
    expect(rawText).not.toContain("phone_e164");
    expect(rawText).not.toContain("29.5124");
    expect(rawText).not.toContain("-98.5742");
    expect(rawText).not.toContain("+12105550101");

    const json = JSON.parse(rawText) as { status: string; h3IndexRes7: string; inviteCode: string };
    expect(json.status).toBe("active");
    expect(json.h3IndexRes7).toBe("874880102ffffff");
    expect(json.inviteCode).toBeTruthy();

    // Replaying the same nonce must fail with 403
    const replay = await createHandler(
      new Request("https://edge.local/create-household", {
        method: "POST",
        headers: {
          Authorization: "Bearer jwt-a",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ attestation, ...payloadWithoutAttestation }),
      }),
    );
    expect(replay.status).toBe(403);
  });

  it("rejects mock GPS, outside San Antonio (422 waitlist), missing phone (403), and quarantines low-precision coords", async () => {
    const redis = createInMemoryRedis();
    const { db, households, failNextProfileInsert } = createInMemoryDb(authUsers);
    const attestationDeps: AttestationDeps = {
      redis: redis.client,
      mode: "dev_bypass",
    };

    const createHandler = createCreateHouseholdHandler({
      db,
      redis: redis.client,
      attestation: attestationDeps,
      latLngToH3Res7: () => "874880102ffffff",
    });

    const sendWithNonce = async (jwt: string, userId: string, body: Record<string, unknown>) => {
      const nonce = `nonce_${Math.random().toString(16).slice(2)}`.padEnd(20, "0");
      await redis.client.setEx(`auth_nonce:${userId}:${nonce}`, 60, "1");
      const payloadHash = await sha256Hex(canonicalizeAttestationPayload(body));
      return createHandler(
        new Request("https://edge.local/create-household", {
          method: "POST",
          headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            attestation: {
              platform: "android",
              nonce,
              token: "play-token",
              payloadHash,
            },
            ...body,
          }),
        }),
      );
    };

    // Missing verified phone
    const noPhoneRes = await sendWithNonce("jwt-no-phone", USER_NO_PHONE, {
      gps: { lat: 29.5124, lng: -98.5742, accuracyMeters: 10 },
      hometownLocationId: "vadodara-alkapuri",
      firstName: "Dev",
    });
    expect(noPhoneRes.status).toBe(403);

    // Mock GPS
    const mockRes = await sendWithNonce("jwt-a", USER_A, {
      gps: { lat: 29.5124, lng: -98.5742, accuracyMeters: 10, mocked: true },
      hometownLocationId: "vadodara-alkapuri",
      firstName: "Aarav",
    });
    expect(mockRes.status).toBe(403);

    // Outside San Antonio -> 422 waitlistEligible
    const outsideRes = await sendWithNonce("jwt-a", USER_A, {
      gps: { lat: 30.2672, lng: -97.7431, accuracyMeters: 10 },
      hometownLocationId: "vadodara-alkapuri",
      firstName: "Aarav",
    });
    expect(outsideRes.status).toBe(422);
    expect(await outsideRes.json()).toMatchObject({
      error: "outside_san_antonio",
      waitlistEligible: true,
    });

    // Rollback on profile insert failure
    failNextProfileInsert.value = true;
    const rollbackRes = await sendWithNonce("jwt-a", USER_A, {
      gps: { lat: 29.5124, lng: -98.5742, accuracyMeters: 10 },
      hometownLocationId: "vadodara-alkapuri",
      firstName: "Aarav",
    });
    expect(rollbackRes.status).toBe(500);
    expect(households.size).toBe(0);

    // Low precision coordinates -> silent quarantine
    const quarantineRes = await sendWithNonce("jwt-a", USER_A, {
      gps: { lat: 29.51, lng: -98.57, accuracyMeters: 10 },
      hometownLocationId: "vadodara-alkapuri",
      firstName: "Aarav",
    });
    expect(quarantineRes.status).toBe(201);
    expect(await quarantineRes.json()).toMatchObject({ status: "quarantined" });
  });

  it("enforces impossible travel (> 600 mph) lock and 25-mile proximity on join-household", async () => {
    const redis = createInMemoryRedis(1_700_000_000_000);
    const { db, households } = createInMemoryDb(authUsers);
    const attestationDeps: AttestationDeps = {
      redis: redis.client,
      mode: "dev_bypass",
    };

    // Seed household via createHouseholdWithAdmin for proximity tests
    const ADMIN_SEED = "99999999-9999-4999-8999-999999999999";
    const hh = await db.createHouseholdWithAdmin({
      displayLabel: "Patel Household",
      lifeStage: "couple",
      exactPoint: { lat: 29.703, lng: -98.1245 }, // New Braunfels (NE edge of polygon)
      publicPoint: { lat: 29.71, lng: -98.13 },
      h3IndexRes7: "874880102ffffff",
      neighborhoodName: "New Braunfels",
      userId: ADMIN_SEED,
      firstName: "Seed",
      avatarUrl: null,
      phoneE164: "+12105559999",
      ageBracket: "30s",
      hometownName: "Alkapuri, Vadodara, Gujarat",
      hometownDistrict: "Vadodara",
      hometownPoint: { lat: 22.3119, lng: 73.1723 },
      interests: [],
      status: "active",
      whatsappAlertsOptIn: false,
      lastVerifiedAt: "2026-11-28T10:00:00.000Z",
    });

    const joinHandler = createJoinHouseholdHandler({
      db,
      redis: redis.client,
      attestation: attestationDeps,
      nowMs: () => 1_700_000_060_000,
    });

    const sendJoin = async (body: Record<string, unknown>) => {
      const nonce = `nonce_${Math.random().toString(16).slice(2)}`.padEnd(20, "0");
      await redis.client.setEx(`auth_nonce:${USER_B}:${nonce}`, 60, "1");
      const payloadHash = await sha256Hex(canonicalizeAttestationPayload(body));
      return joinHandler(
        new Request("https://edge.local/join-household", {
          method: "POST",
          headers: { Authorization: "Bearer jwt-b", "Content-Type": "application/json" },
          body: JSON.stringify({
            attestation: { platform: "android", nonce, token: "tok", payloadHash },
            ...body,
          }),
        }),
      );
    };

    // Alamo Ranch is inside San Antonio polygon, but > 35 miles from New Braunfels -> 403
    const farJoin = await sendJoin({
      gps: { lat: 29.4928, lng: -98.7115, accuracyMeters: 15 },
      inviteCode: hh.invite_code,
      hometownLocationId: "surat-vesu",
      firstName: "Diya",
    });
    expect(farJoin.status).toBe(403);
    expect(await farJoin.json()).toMatchObject({ error: "outside_household_proximity" });

    // Impossible travel: seed last_gps in Ahmedabad 60 seconds ago -> locks pin updates for 24h
    await redis.client.setEx(
      `last_gps:${USER_B}`,
      3600,
      JSON.stringify({ lat: 23.0225, lng: 72.5714, timestampMs: 1_700_000_000_000 }),
    );
    const teleportRes = await sendJoin({
      gps: { lat: 29.7031, lng: -98.1246, accuracyMeters: 15 },
      inviteCode: hh.invite_code,
      hometownLocationId: "surat-vesu",
      firstName: "Diya",
    });
    expect(teleportRes.status).toBe(403);
    expect(await teleportRes.json()).toMatchObject({ error: "impossible_travel" });
    expect(await redis.client.get(`pin_lock:${USER_B}`)).toBe("1");

    // Clear lock & last_gps -> valid join succeeds and omits inviteCode
    redis.store.delete(`pin_lock:${USER_B}`);
    redis.store.delete(`last_gps:${USER_B}`);
    const okJoin = await sendJoin({
      gps: { lat: 29.7031, lng: -98.1246, accuracyMeters: 15 },
      inviteCode: hh.invite_code,
      hometownLocationId: "surat-vesu",
      firstName: "Diya",
    });
    expect(okJoin.status).toBe(201);
    const okBody = (await okJoin.json()) as Record<string, unknown>;
    expect(okBody.householdId).toBe(hh.id);
    expect(okBody.inviteCode).toBeUndefined();
    expect(households.size).toBe(1);
  });

  it("verifies Google Play Integrity and enforces connection request blocks & 10/25 rate limits", async () => {
    const redis = createInMemoryRedis();
    const { db, households, users, connections } = createInMemoryDb(authUsers);

    const hhA = await db.createHouseholdWithAdmin({
      displayLabel: "A",
      lifeStage: "couple",
      exactPoint: { lat: 29.5124, lng: -98.5742 },
      publicPoint: { lat: 29.52, lng: -98.58 },
      h3IndexRes7: "874880102ffffff",
      neighborhoodName: "Medical Center",
      userId: USER_A,
      firstName: "Aarav",
      avatarUrl: null,
      phoneE164: "+12105550101",
      ageBracket: "30s",
      hometownName: "Alkapuri, Vadodara, Gujarat",
      hometownDistrict: "Vadodara",
      hometownPoint: { lat: 22.3119, lng: 73.1723 },
      interests: [],
      status: "active",
      whatsappAlertsOptIn: false,
      lastVerifiedAt: "2026-11-28T10:00:00.000Z",
    });
    const hhB = await db.createHouseholdWithAdmin({
      displayLabel: "B",
      lifeStage: "couple",
      exactPoint: { lat: 29.6472, lng: -98.4864 },
      publicPoint: { lat: 29.65, lng: -98.49 },
      h3IndexRes7: "874880103ffffff",
      neighborhoodName: "Stone Oak",
      userId: USER_B,
      firstName: "Diya",
      avatarUrl: null,
      phoneE164: "+12105550202",
      ageBracket: "30s",
      hometownName: "Vesu, Surat, Gujarat",
      hometownDistrict: "Surat",
      hometownPoint: { lat: 21.1418, lng: 72.7709 },
      interests: [],
      status: "active",
      whatsappAlertsOptIn: false,
      lastVerifiedAt: "2026-11-28T10:00:00.000Z",
    });

    const rsa = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", rsa.privateKey));
    let pkcs8Bin = "";
    for (const b of pkcs8) pkcs8Bin += String.fromCharCode(b);
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(pkcs8Bin)}\n-----END PRIVATE KEY-----`;

    const connBody = {
      recipientId: USER_B,
      icebreakerText: "Kem cho! Live near Medical Center too.",
    };
    const nonce = "0123456789abcdef0123456789abcdef";
    await redis.client.setEx(`auth_nonce:${USER_A}:${nonce}`, 60, "1");
    const payloadHash = await sha256Hex(canonicalizeAttestationPayload(connBody));
    const expectedGoogleNonce = base64UrlEncode(await sha256Bytes(`${nonce}:${payloadHash}`));

    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com")) {
        return new Response(JSON.stringify({ access_token: "ya29.mock" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          tokenPayloadExternal: {
            requestDetails: {
              requestPackageName: "app.secondhome.mobile",
              nonce: expectedGoogleNonce,
            },
            appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED" },
            deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
          },
        }),
        { status: 200 },
      );
    };

    const handler = createSendConnectionRequestHandler({
      db,
      redis: redis.client,
      attestation: {
        redis: redis.client,
        mode: "enforce",
        googlePackageName: "app.secondhome.mobile",
        googleServiceAccountJson: JSON.stringify({
          client_email: "play@secondhome.iam.gserviceaccount.com",
          private_key: pem,
        }),
        fetchImpl: mockFetch,
      },
    });

    const okRes = await handler(
      new Request("https://edge.local/send-connection-request", {
        method: "POST",
        headers: { Authorization: "Bearer jwt-a", "Content-Type": "application/json" },
        body: JSON.stringify({
          attestation: {
            platform: "android",
            nonce,
            token: "play-integrity-jws",
            payloadHash,
          },
          ...connBody,
        }),
      }),
    );
    expect(okRes.status).toBe(201);
    expect(connections.length).toBe(1);

    // Rate limit test: 10/24h for non-Verified Local -> 11th returns 429
    const rlHandler = createSendConnectionRequestHandler({
      db,
      redis: redis.client,
      attestation: { redis: redis.client, mode: "dev_bypass" },
    });

    connections.length = 0;
    for (let i = 0; i < 9; i++) {
      const n = `rl_nonce_${i}`.padEnd(20, "0");
      await redis.client.setEx(`auth_nonce:${USER_A}:${n}`, 60, "1");
      const r = await rlHandler(
        new Request("https://edge.local/send-connection-request", {
          method: "POST",
          headers: { Authorization: "Bearer jwt-a", "Content-Type": "application/json" },
          body: JSON.stringify({
            attestation: { platform: "android", nonce: n, token: "t", payloadHash },
            ...connBody,
          }),
        }),
      );
      expect(r.status).toBe(201);
      connections.length = 0;
    }

    const n11 = "rl_nonce_11".padEnd(20, "0");
    await redis.client.setEx(`auth_nonce:${USER_A}:${n11}`, 60, "1");
    const r11 = await rlHandler(
      new Request("https://edge.local/send-connection-request", {
        method: "POST",
        headers: { Authorization: "Bearer jwt-a", "Content-Type": "application/json" },
        body: JSON.stringify({
          attestation: { platform: "android", nonce: n11, token: "t", payloadHash },
          ...connBody,
        }),
      }),
    );
    expect(r11.status).toBe(429);
    expect(r11.headers.get("Retry-After")).toBeTruthy();

    // Mark household A as Verified Local -> limit increases to 25/24h
    const existingHhA = households.get(hhA.id);
    if (existingHhA) {
      existingHhA.is_verified_local = true;
    }
    const n12 = "rl_nonce_12".padEnd(20, "0");
    await redis.client.setEx(`auth_nonce:${USER_A}:${n12}`, 60, "1");
    const r12 = await rlHandler(
      new Request("https://edge.local/send-connection-request", {
        method: "POST",
        headers: { Authorization: "Bearer jwt-a", "Content-Type": "application/json" },
        body: JSON.stringify({
          attestation: { platform: "android", nonce: n12, token: "t", payloadHash },
          ...connBody,
        }),
      }),
    );
    expect(r12.status).toBe(201);

    // Duplicate pending/accepted connection -> 409
    const nDup = "rl_nonce_dup".padEnd(20, "0");
    await redis.client.setEx(`auth_nonce:${USER_A}:${nDup}`, 60, "1");
    const rDup = await rlHandler(
      new Request("https://edge.local/send-connection-request", {
        method: "POST",
        headers: { Authorization: "Bearer jwt-a", "Content-Type": "application/json" },
        body: JSON.stringify({
          attestation: { platform: "android", nonce: nDup, token: "t", payloadHash },
          ...connBody,
        }),
      }),
    );
    expect(rDup.status).toBe(409);

    // Blocked household -> 403
    connections.length = 0;
    connections.push({
      id: "00000000-0000-4000-9000-000000000099",
      requester_id: USER_B,
      recipient_id: USER_A,
      status: "blocked",
      created_at: "2026-11-28T10:00:00.000Z",
    });
    const nBlocked = "rl_nonce_blk".padEnd(20, "0");
    await redis.client.setEx(`auth_nonce:${USER_A}:${nBlocked}`, 60, "1");
    const rBlocked = await rlHandler(
      new Request("https://edge.local/send-connection-request", {
        method: "POST",
        headers: { Authorization: "Bearer jwt-a", "Content-Type": "application/json" },
        body: JSON.stringify({
          attestation: { platform: "android", nonce: nBlocked, token: "t", payloadHash },
          ...connBody,
        }),
      }),
    );
    expect(rBlocked.status).toBe(403);

    // Self-connection & URL in icebreaker -> 400
    const rSelf = await rlHandler(
      new Request("https://edge.local/send-connection-request", {
        method: "POST",
        headers: { Authorization: "Bearer jwt-a", "Content-Type": "application/json" },
        body: JSON.stringify({
          attestation: { platform: "android", nonce: nBlocked, token: "t", payloadHash },
          recipientId: USER_A,
          icebreakerText: "Hi self",
        }),
      }),
    );
    expect(rSelf.status).toBe(400);

    const rUrl = await rlHandler(
      new Request("https://edge.local/send-connection-request", {
        method: "POST",
        headers: { Authorization: "Bearer jwt-a", "Content-Type": "application/json" },
        body: JSON.stringify({
          attestation: { platform: "android", nonce: nBlocked, token: "t", payloadHash },
          recipientId: USER_B,
          icebreakerText: "Join me at https://phish.example",
        }),
      }),
    );
    expect(rUrl.status).toBe(400);

    const rFormattedPhone = await rlHandler(
      new Request("https://edge.local/send-connection-request", {
        method: "POST",
        headers: { Authorization: "Bearer jwt-a", "Content-Type": "application/json" },
        body: JSON.stringify({
          attestation: { platform: "android", nonce: nBlocked, token: "t", payloadHash },
          recipientId: USER_B,
          icebreakerText: "Call +1 (210) 555 - 1234",
        }),
      }),
    );
    expect(rFormattedPhone.status).toBe(400);
  });

  it("enforces streaming maxBytes, HTTPS Upstash URLs, redirect:error, Google 503 outage, and Apple key enrollment + atomic counter", async () => {
    // 1. Streaming maxBytes without Content-Length -> 413
    const largeStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(200)));
        controller.close();
      },
    });
    const streamReq = new Request("https://edge.local/test", {
      method: "POST",
      body: largeStream,
      duplex: "half",
    } as RequestInit);
    const parsedStream = await parseJsonBody(streamReq, 64);
    expect(parsedStream.ok).toBe(false);
    if (!parsedStream.ok) {
      expect(parsedStream.response.status).toBe(413);
    }

    // 2. Upstash Redis rejects non-HTTPS URLs and passes redirect: "error"
    expect(() => createUpstashRedisClient("http://insecure.upstash.io", "tok")).toThrow();
    let capturedRedirect: RequestRedirect | undefined;
    const secureClient = createUpstashRedisClient(
      "https://secure.upstash.io",
      "tok",
      async (_url, init) => {
        capturedRedirect = init?.redirect;
        return new Response(JSON.stringify({ result: "OK" }), { status: 200 });
      },
    );
    await secureClient.setEx("k", 10, "v");
    expect(capturedRedirect).toBe("error");

    // 3. Google Play Integrity returns 503 on upstream 503
    const redis = createInMemoryRedis();
    const { db, users } = createInMemoryDb(authUsers);
    const hhA = await db.createHouseholdWithAdmin({
      displayLabel: "A",
      lifeStage: "couple",
      exactPoint: { lat: 29.5124, lng: -98.5742 },
      publicPoint: { lat: 29.52, lng: -98.58 },
      h3IndexRes7: "874880102ffffff",
      neighborhoodName: "Medical Center",
      userId: USER_A,
      firstName: "Aarav",
      avatarUrl: null,
      phoneE164: "+12105550101",
      ageBracket: "30s",
      hometownName: "Alkapuri, Vadodara, Gujarat",
      hometownDistrict: "Vadodara",
      hometownPoint: { lat: 22.3119, lng: 73.1723 },
      interests: [],
      status: "active",
      whatsappAlertsOptIn: false,
      lastVerifiedAt: "2026-11-28T10:00:00.000Z",
    });
    const hhB = await db.createHouseholdWithAdmin({
      displayLabel: "B",
      lifeStage: "couple",
      exactPoint: { lat: 29.6472, lng: -98.4864 },
      publicPoint: { lat: 29.65, lng: -98.49 },
      h3IndexRes7: "874880103ffffff",
      neighborhoodName: "Stone Oak",
      userId: USER_B,
      firstName: "Diya",
      avatarUrl: null,
      phoneE164: "+12105550202",
      ageBracket: "30s",
      hometownName: "Vesu, Surat, Gujarat",
      hometownDistrict: "Surat",
      hometownPoint: { lat: 21.1418, lng: 72.7709 },
      interests: [],
      status: "active",
      whatsappAlertsOptIn: false,
      lastVerifiedAt: "2026-11-28T10:00:00.000Z",
    });
    expect(users.has(USER_A) && hhA.id && hhB.id).toBeTruthy();

    const rsa = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", rsa.privateKey));
    let pkcs8Bin = "";
    for (const b of pkcs8) pkcs8Bin += String.fromCharCode(b);
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(pkcs8Bin)}\n-----END PRIVATE KEY-----`;

    const connBody = { recipientId: USER_B, icebreakerText: "Kem cho!" };
    const payloadHash = await sha256Hex(canonicalizeAttestationPayload(connBody));
    const nOutage = "outage_nonce_12345678";
    await redis.client.setEx(`auth_nonce:${USER_A}:${nOutage}`, 60, "1");

    const outageHandler = createSendConnectionRequestHandler({
      db,
      redis: redis.client,
      attestation: {
        redis: redis.client,
        mode: "enforce",
        googlePackageName: "app.secondhome.mobile",
        googleServiceAccountJson: JSON.stringify({
          client_email: "play@secondhome.iam.gserviceaccount.com",
          private_key: pem,
        }),
        fetchImpl: async (input) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("oauth2.googleapis.com")) {
            return new Response(JSON.stringify({ access_token: "ya29.mock" }), { status: 200 });
          }
          return new Response("Service Unavailable", { status: 503 });
        },
      },
    });
    const outageRes = await outageHandler(
      new Request("https://edge.local/send-connection-request", {
        method: "POST",
        headers: { Authorization: "Bearer jwt-a", "Content-Type": "application/json" },
        body: JSON.stringify({
          attestation: { platform: "android", nonce: nOutage, token: "t", payloadHash },
          ...connBody,
        }),
      }),
    );
    expect(outageRes.status).toBe(503);

    // 4. Apple App Attest key enrollment via POST /auth-challenge + atomic counter guard
    const ecKey = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", ecKey.publicKey));
    const xCoord = rawPub.slice(1, 33);
    const yCoord = rawPub.slice(33, 65);
    const credId = await sha256Bytes(rawPub);
    let keyIdBin = "";
    for (const b of credId) keyIdBin += String.fromCharCode(b);
    const keyId = btoa(keyIdBin);

    const enc = new TextEncoder();
    const cborBytes = (b: Uint8Array) => {
      const header =
        b.length < 24 ? new Uint8Array([0x40 | b.length]) : new Uint8Array([0x58, b.length]);
      const out = new Uint8Array(header.length + b.length);
      out.set(header, 0);
      out.set(b, header.length);
      return out;
    };
    const cborText = (t: string) => {
      const b = enc.encode(t);
      const out = new Uint8Array(1 + b.length);
      out[0] = 0x60 | b.length;
      out.set(b, 1);
      return out;
    };
    const coseKeyCbor = new Uint8Array([
      0xa5,
      0x01,
      0x02, // 1 (kty): 2 (EC2)
      0x03,
      0x26, // 3 (alg): -7 (ES256)
      0x20,
      0x01, // -1 (crv): 1 (P-256)
      0x21,
      ...cborBytes(xCoord), // -2 (x)
      0x22,
      ...cborBytes(yCoord), // -3 (y)
    ]);

    const rpIdHash = await sha256Bytes(APPLE_APP_ID);
    const authData = new Uint8Array(55 + credId.length + coseKeyCbor.length);
    authData.set(rpIdHash, 0);
    authData[32] = 0x41; // AT + UP
    new DataView(authData.buffer).setUint32(33, 0, false); // signCount = 0
    new DataView(authData.buffer).setUint16(53, credId.length, false);
    authData.set(credId, 55);
    authData.set(coseKeyCbor, 55 + credId.length);

    const regNonce = "reg_nonce_0123456789abcdef";
    await redis.client.setEx(`auth_nonce:${USER_A}:${regNonce}`, 60, "1");
    const certNonce = await sha256Bytes(
      new Uint8Array([...authData, ...(await sha256Bytes(regNonce))]),
    );
    const mockLeafCert = new Uint8Array([
      0x30,
      0x30,
      0x06,
      0x09,
      0x2a,
      0x86,
      0x48,
      0x86,
      0xf7,
      0x63,
      0x64,
      0x08,
      0x02,
      0x04,
      0x20,
      ...certNonce,
    ]);
    const attObj = new Uint8Array([
      0xa3,
      ...cborText("fmt"),
      ...cborText("apple-appattest"),
      ...cborText("attStmt"),
      0xa1,
      ...cborText("x5c"),
      0x81,
      ...cborBytes(mockLeafCert),
      ...cborText("authData"),
      ...cborBytes(authData),
    ]);
    let attBin = "";
    for (const b of attObj) attBin += String.fromCharCode(b);

    const challengeHandler = createAuthChallengeHandler({
      db,
      redis: redis.client,
      attestation: { redis: redis.client, mode: "enforce", appleAppId: APPLE_APP_ID },
    });
    const regRes = await challengeHandler(
      new Request("https://edge.local/auth-challenge", {
        method: "POST",
        headers: { Authorization: "Bearer jwt-a", "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register_apple_key",
          keyId,
          attestationObject: btoa(attBin),
          nonce: regNonce,
        }),
      }),
    );
    expect(regRes.status).toBe(201);

    // Atomic counter advance: 1 succeeds, re-advancing to 1 fails
    const redisKey = `app_attest_key:${USER_A}:${keyId}`;
    expect(await redis.client.compareAndAdvanceCounter(redisKey, 1, 3600)).toBe(true);
    expect(await redis.client.compareAndAdvanceCounter(redisKey, 1, 3600)).toBe(false);
  });
});
