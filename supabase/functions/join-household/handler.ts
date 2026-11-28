import type { AttestationDeps } from "../_shared/attestation.ts";
import { isWithinHouseholdJoinProximity, parsePostgisPoint } from "../_shared/geo.ts";
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
import { JoinHouseholdRequestSchema } from "../_shared/validation.ts";

export type JoinHouseholdDeps = {
  db: EdgeDbAdapter;
  redis: UpstashRedisClient;
  attestation: AttestationDeps;
  nowMs?: () => number;
};

export function createJoinHouseholdHandler(deps: JoinHouseholdDeps) {
  return async function handleJoinHousehold(req: Request): Promise<Response> {
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

    const parsed = JoinHouseholdRequestSchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      return errorResponse(400, "invalid_request", "Invalid household join payload.");
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

    let household: NonNullable<Awaited<ReturnType<typeof deps.db.getHouseholdByInviteCode>>>;
    let hometown: NonNullable<Awaited<ReturnType<typeof deps.db.getGujaratLocation>>>;
    const joinerPoint = { lat: parsed.data.gps.lat, lng: parsed.data.gps.lng };
    try {
      const existingProfile = await deps.db.getUserProfile(authUser.id);
      if (existingProfile) {
        return errorResponse(
          409,
          "user_already_in_household",
          "Account already belongs to a household.",
        );
      }

      const foundHousehold = await deps.db.getHouseholdByInviteCode(parsed.data.inviteCode);
      if (!foundHousehold) {
        return errorResponse(404, "invalid_invite_code", "Household invite code was not found.");
      }
      household = foundHousehold;

      const householdExact = parsePostgisPoint(household.exact_current_geog);
      if (!householdExact) {
        return errorResponse(
          500,
          "household_location_invalid",
          "Unable to verify household location.",
        );
      }

      const proximity = isWithinHouseholdJoinProximity(joinerPoint, householdExact);
      if (!proximity.withinProximity) {
        return errorResponse(
          403,
          "outside_household_proximity",
          "Your live GPS must be within 25 miles of the household to join with an invite code.",
        );
      }

      const foundHometown = await deps.db.getGujaratLocation(parsed.data.hometownLocationId);
      if (!foundHometown) {
        return errorResponse(
          400,
          "invalid_hometown_location",
          "Unknown Gujarat hometown location.",
        );
      }
      hometown = foundHometown;
    } catch {
      return errorResponse(503, "service_unavailable", "Unable to join household right now.");
    }

    try {
      await deps.db.createUserProfile({
        id: authUser.id,
        householdId: household.id,
        isHouseholdAdmin: false,
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
      const code = (err as { code?: string }).code;
      if (code === "23505") {
        return errorResponse(
          409,
          "user_already_in_household",
          "Account already belongs to a household.",
        );
      }
      return errorResponse(500, "join_household_failed", "Unable to join household.");
    }

    await recordLastGpsFix(deps.redis, authUser.id, joinerPoint, gate.nowMs).catch(() => undefined);

    const publicPoint = parsePostgisPoint(household.public_current_geog);
    return jsonResponse(
      {
        householdId: household.id,
        displayLabel: household.display_label,
        lifeStage: household.life_stage,
        neighborhoodName: household.neighborhood_name,
        h3IndexRes7: household.h3_index_res7,
        publicLat: publicPoint?.lat ?? null,
        publicLng: publicPoint?.lng ?? null,
        status: gate.accountStatus,
        isVerifiedLocal: household.is_verified_local,
      },
      201,
    );
  };
}
