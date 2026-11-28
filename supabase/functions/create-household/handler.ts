import type { AttestationDeps } from "../_shared/attestation.ts";
import {
  computeStaticFuzzedPoint,
  cryptoRandomUnit,
  inferSanAntonioNeighborhood,
} from "../_shared/geo.ts";
import { recordLastGpsFix, runHouseholdGpsAndAttestationGate } from "../_shared/gpsGate.ts";
import {
  errorResponse,
  extractBearerToken,
  handleCorsPreflight,
  jsonResponse,
  parseJsonBody,
} from "../_shared/http.ts";
import type { UpstashRedisClient } from "../_shared/redis.ts";
import type { EdgeDbAdapter } from "../_shared/supabase.ts";
import { CreateHouseholdRequestSchema } from "../_shared/validation.ts";

export type CreateHouseholdDeps = {
  db: EdgeDbAdapter;
  redis: UpstashRedisClient;
  attestation: AttestationDeps;
  latLngToH3Res7: (lat: number, lng: number) => string;
  rng?: () => number;
  nowMs?: () => number;
};

export function createCreateHouseholdHandler(deps: CreateHouseholdDeps) {
  return async function handleCreateHousehold(req: Request): Promise<Response> {
    const preflight = handleCorsPreflight(req);
    if (preflight) {
      return preflight;
    }

    if (req.method !== "POST") {
      return errorResponse(405, "method_not_allowed", "Method not allowed.");
    }

    const token = extractBearerToken(req);
    if (!token) {
      return errorResponse(401, "unauthorized", "Authentication required.");
    }

    let authUser: Awaited<ReturnType<typeof deps.db.getAuthUser>>;
    try {
      authUser = await deps.db.getAuthUser(token);
    } catch {
      return errorResponse(503, "service_unavailable", "Unable to verify session.");
    }
    if (!authUser) {
      return errorResponse(401, "unauthorized", "Invalid or expired session.");
    }

    const bodyResult = await parseJsonBody(req);
    if (!bodyResult.ok) {
      return bodyResult.response;
    }

    const parsed = CreateHouseholdRequestSchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      return errorResponse(400, "invalid_request", "Invalid household creation payload.");
    }

    const rawBody = bodyResult.data as Record<string, unknown>;
    const { attestation: _att, ...payloadWithoutAttestation } = rawBody;
    void _att;

    const gate = await runHouseholdGpsAndAttestationGate({
      userId: authUser.id,
      phoneE164: authUser.phone,
      attestation: parsed.data.attestation,
      requestPayloadWithoutAttestation: payloadWithoutAttestation,
      gps: parsed.data.gps,
      deps: {
        db: deps.db,
        redis: deps.redis,
        attestation: deps.attestation,
        nowMs: deps.nowMs,
      },
    });
    if (!gate.ok) {
      return gate.response;
    }

    let existingProfile: Awaited<ReturnType<typeof deps.db.getUserProfile>>;
    let hometown: Awaited<ReturnType<typeof deps.db.getGujaratLocation>>;
    try {
      existingProfile = await deps.db.getUserProfile(authUser.id);
      if (existingProfile) {
        return errorResponse(
          409,
          "user_already_in_household",
          "Account already belongs to a household.",
        );
      }

      hometown = await deps.db.getGujaratLocation(parsed.data.hometownLocationId);
      if (!hometown) {
        return errorResponse(
          400,
          "invalid_hometown_location",
          "Unknown Gujarat hometown location.",
        );
      }
    } catch {
      return errorResponse(503, "service_unavailable", "Unable to create household right now.");
    }

    const exactPoint = { lat: parsed.data.gps.lat, lng: parsed.data.gps.lng };
    const { fuzzedCenter } = computeStaticFuzzedPoint(exactPoint, deps.rng ?? cryptoRandomUnit);
    const h3IndexRes7 = deps.latLngToH3Res7(fuzzedCenter.lat, fuzzedCenter.lng);
    const neighborhoodName = inferSanAntonioNeighborhood(fuzzedCenter);

    let createdHousehold: Awaited<ReturnType<typeof deps.db.createHouseholdWithAdmin>>;
    try {
      createdHousehold = await deps.db.createHouseholdWithAdmin({
        displayLabel: parsed.data.displayLabel ?? `${parsed.data.firstName}'s Household`,
        lifeStage: parsed.data.lifeStage ?? null,
        exactPoint,
        publicPoint: fuzzedCenter,
        h3IndexRes7,
        neighborhoodName,
        userId: authUser.id,
        firstName: parsed.data.firstName,
        avatarUrl: parsed.data.avatarUrl ?? null,
        phoneE164: gate.phoneE164,
        ageBracket: parsed.data.ageBracket ?? null,
        hometownName: hometown.display_name,
        hometownDistrict: hometown.district,
        hometownPoint: { lat: hometown.lat, lng: hometown.lng },
        interests: parsed.data.interests,
        status: gate.accountStatus,
        whatsappAlertsOptIn: parsed.data.whatsappAlertsOptIn,
        lastVerifiedAt: new Date(gate.nowMs).toISOString(),
      });
    } catch (err) {
      const pgErr = err as { code?: string; details?: string; messageDetail?: string };
      if (pgErr.code === "23505") {
        const detailText = `${pgErr.details ?? ""} ${pgErr.messageDetail ?? ""}`;
        if (detailText.includes("users_phone_e164_key")) {
          return errorResponse(
            409,
            "phone_already_in_use",
            "This phone number is already registered to another household.",
          );
        }
        if (detailText.includes("users_pkey") || !detailText.trim()) {
          return errorResponse(
            409,
            "user_already_in_household",
            "Account already belongs to a household.",
          );
        }
      }
      return errorResponse(500, "create_household_failed", "Unable to create household.");
    }

    await recordLastGpsFix(deps.redis, authUser.id, exactPoint, gate.nowMs).catch(() => undefined);

    return jsonResponse(
      {
        householdId: createdHousehold.id,
        displayLabel: createdHousehold.display_label,
        lifeStage: createdHousehold.life_stage,
        neighborhoodName: createdHousehold.neighborhood_name,
        h3IndexRes7: createdHousehold.h3_index_res7,
        publicLat: fuzzedCenter.lat,
        publicLng: fuzzedCenter.lng,
        inviteCode: createdHousehold.invite_code,
        status: gate.accountStatus,
        isVerifiedLocal: createdHousehold.is_verified_local,
      },
      201,
    );
  };
}
