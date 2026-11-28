import { type AttestationDeps, verifyRequestAttestation } from "./attestation.ts";
import {
  detectCoordinatePrecisionAnomaly,
  evaluateImpossibleTravel,
  isPointInGreaterSanAntonio,
} from "./geo.ts";
import { errorResponse } from "./http.ts";
import type { UpstashRedisClient } from "./redis.ts";
import type { EdgeDbAdapter } from "./supabase.ts";
import {
  type AttestationPayload,
  type GpsFixInput,
  PIN_UPDATE_LOCK_SECONDS,
} from "./validation.ts";

export type LastGpsRecord = {
  lat: number;
  lng: number;
  timestampMs: number;
};

export type GpsGateDeps = {
  db: EdgeDbAdapter;
  redis: UpstashRedisClient;
  attestation: AttestationDeps;
  nowMs?: () => number;
};

export type GpsGateSuccess = {
  ok: true;
  userId: string;
  phoneE164: string;
  accountStatus: "active" | "quarantined";
  nowMs: number;
};

export type GpsGateFailure = {
  ok: false;
  response: Response;
};

/**
 * Shared security gate for household creation and joining:
 * 1. Verified phone on authenticated Supabase user
 * 2. Cryptographic attestation + single-use 60s nonce + payload hash
 * 3. Pin-update 24h lock check
 * 4. Mock GPS rejection
 * 5. Greater San Antonio bounding polygon check (waitlist-eligible 422)
 * 6. Impossible travel (> 600 mph) check -> 24h lock
 * 7. Precision anomaly check -> silent quarantine
 */
export async function runHouseholdGpsAndAttestationGate(params: {
  userId: string;
  phoneE164: string | null;
  attestation: AttestationPayload;
  requestPayloadWithoutAttestation: unknown;
  gps: GpsFixInput;
  deps: GpsGateDeps;
}): Promise<GpsGateSuccess | GpsGateFailure> {
  const { userId, phoneE164, attestation, requestPayloadWithoutAttestation, gps, deps } = params;
  const nowMs = (deps.nowMs ?? Date.now)();

  if (!phoneE164) {
    return {
      ok: false,
      response: errorResponse(
        403,
        "phone_verification_required",
        "Phone verification is required before claiming a household pin.",
      ),
    };
  }

  const attestationResult = await verifyRequestAttestation({
    userId,
    attestation,
    requestPayloadWithoutAttestation,
    deps: deps.attestation,
  });
  if (!attestationResult.ok) {
    return {
      ok: false,
      response: errorResponse(
        attestationResult.status,
        attestationResult.error,
        attestationResult.message,
      ),
    };
  }

  let lockActive: string | null;
  try {
    lockActive = await deps.redis.get(`pin_lock:${userId}`);
  } catch {
    return {
      ok: false,
      response: errorResponse(503, "service_unavailable", "Unable to verify security state."),
    };
  }
  if (lockActive) {
    return {
      ok: false,
      response: errorResponse(
        403,
        "pin_updates_locked",
        "Location updates are temporarily locked for 24 hours.",
      ),
    };
  }

  if (gps.mocked === true) {
    return {
      ok: false,
      response: errorResponse(
        403,
        "mock_gps_detected",
        "Disable mock location apps to verify your San Antonio neighborhood.",
      ),
    };
  }

  if (!isPointInGreaterSanAntonio({ lat: gps.lat, lng: gps.lng })) {
    return {
      ok: false,
      response: errorResponse(
        422,
        "outside_san_antonio",
        "We're currently live in Greater San Antonio! Join the waitlist for your city.",
        { waitlistEligible: true },
      ),
    };
  }

  let previousGps: LastGpsRecord | null = null;
  try {
    const rawLastGps = await deps.redis.get(`last_gps:${userId}`);
    if (rawLastGps) {
      const parsed = JSON.parse(rawLastGps) as Partial<LastGpsRecord>;
      if (
        typeof parsed.lat === "number" &&
        typeof parsed.lng === "number" &&
        typeof parsed.timestampMs === "number"
      ) {
        previousGps = { lat: parsed.lat, lng: parsed.lng, timestampMs: parsed.timestampMs };
      }
    }
  } catch {
    previousGps = null;
  }

  if (!previousGps) {
    const existingProfile = await deps.db.getUserProfile(userId);
    if (existingProfile?.last_verified_at) {
      const parsedTs = Date.parse(existingProfile.last_verified_at);
      if (Number.isFinite(parsedTs)) {
        const exactPoint = await deps.db.getHouseholdExactPoint(existingProfile.household_id);
        if (exactPoint) {
          previousGps = { lat: exactPoint.lat, lng: exactPoint.lng, timestampMs: parsedTs };
        }
      }
    }
  }

  if (previousGps) {
    const travel = evaluateImpossibleTravel(previousGps, {
      lat: gps.lat,
      lng: gps.lng,
      timestampMs: nowMs,
    });
    if (travel.impossible) {
      try {
        await deps.redis.setEx(`pin_lock:${userId}`, PIN_UPDATE_LOCK_SECONDS, "1");
      } catch {
        // Still reject the request even if lock persistence fails
      }
      return {
        ok: false,
        response: errorResponse(
          403,
          "impossible_travel",
          "Location change exceeded plausible travel speed. Pin updates locked for 24 hours.",
        ),
      };
    }
  }

  const precisionCheck = detectCoordinatePrecisionAnomaly(gps);
  const accountStatus: "active" | "quarantined" = precisionCheck.anomalous
    ? "quarantined"
    : "active";

  return {
    ok: true,
    userId,
    phoneE164,
    accountStatus,
    nowMs,
  };
}

export async function recordLastGpsFix(
  redis: UpstashRedisClient,
  userId: string,
  gps: { lat: number; lng: number },
  timestampMs: number,
): Promise<void> {
  await redis.setEx(
    `last_gps:${userId}`,
    60 * 60 * 24 * 30,
    JSON.stringify({ lat: gps.lat, lng: gps.lng, timestampMs }),
  );
}
