import { type AttestationDeps, verifyRequestAttestation } from "../_shared/attestation.ts";
import {
  errorResponse,
  extractBearerToken,
  handleCorsPreflight,
  jsonResponse,
  parseJsonBody,
} from "../_shared/http.ts";
import type { UpstashRedisClient } from "../_shared/redis.ts";
import type { EdgeDbAdapter } from "../_shared/supabase.ts";
import {
  CONNECTION_RATE_LIMIT_NEW_ACCOUNT,
  CONNECTION_RATE_LIMIT_VERIFIED_LOCAL,
  CONNECTION_RATE_LIMIT_WINDOW_SECONDS,
  SendConnectionRequestSchema,
} from "../_shared/validation.ts";

export type SendConnectionRequestDeps = {
  db: EdgeDbAdapter;
  redis: UpstashRedisClient;
  attestation: AttestationDeps;
  nowMs?: () => number;
};

export function createSendConnectionRequestHandler(deps: SendConnectionRequestDeps) {
  return async function handleSendConnectionRequest(req: Request): Promise<Response> {
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

    const parsed = SendConnectionRequestSchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message ?? "Invalid connection request payload.";
      return errorResponse(400, "invalid_request", firstIssue);
    }

    if (parsed.data.recipientId === authUser.id) {
      return errorResponse(400, "self_connection_not_allowed", "You cannot connect with yourself.");
    }

    const rawBody = bodyResult.data as Record<string, unknown>;
    const { attestation: _att, ...payloadWithoutAttestation } = rawBody;
    void _att;

    const attestationResult = await verifyRequestAttestation({
      userId: authUser.id,
      attestation: parsed.data.attestation,
      requestPayloadWithoutAttestation: payloadWithoutAttestation,
      deps: deps.attestation,
    });
    if (!attestationResult.ok) {
      return errorResponse(
        attestationResult.status,
        attestationResult.error,
        attestationResult.message,
      );
    }

    let requester: NonNullable<Awaited<ReturnType<typeof deps.db.getUserProfile>>>;
    let recipient: NonNullable<Awaited<ReturnType<typeof deps.db.getUserProfile>>>;
    let isVerifiedLocal: boolean;
    try {
      const foundRequester = await deps.db.getUserProfile(authUser.id);
      if (!foundRequester || foundRequester.status !== "active") {
        return errorResponse(
          403,
          "account_not_active",
          "Your account must be active before sending connection requests.",
        );
      }
      requester = foundRequester;

      const foundRecipient = await deps.db.getUserProfile(parsed.data.recipientId);
      if (!foundRecipient || foundRecipient.status !== "active") {
        return errorResponse(404, "recipient_unavailable", "Recipient is not available.");
      }
      recipient = foundRecipient;

      if (recipient.household_id === requester.household_id) {
        return errorResponse(
          400,
          "same_household",
          "You cannot send a connection request to your own household.",
        );
      }

      const isBlocked = await deps.db.hasBlockedConnectionWithHousehold(
        requester.id,
        recipient.household_id,
      );
      if (isBlocked) {
        return errorResponse(403, "connection_blocked", "Unable to connect with this household.");
      }

      const hasExisting = await deps.db.hasExistingActiveOrPendingConnection(
        requester.id,
        recipient.id,
      );
      if (hasExisting) {
        return errorResponse(
          409,
          "connection_already_exists",
          "A connection request already exists with this neighbor.",
        );
      }

      isVerifiedLocal = await deps.db.isHouseholdVerifiedLocal(requester.household_id);
    } catch {
      return errorResponse(
        503,
        "service_unavailable",
        "Unable to process connection request right now.",
      );
    }
    const limit = isVerifiedLocal
      ? CONNECTION_RATE_LIMIT_VERIFIED_LOCAL
      : CONNECTION_RATE_LIMIT_NEW_ACCOUNT;

    const nowMs = (deps.nowMs ?? Date.now)();
    let rateResult: Awaited<ReturnType<typeof deps.redis.slidingWindowLimit>>;
    try {
      rateResult = await deps.redis.slidingWindowLimit(
        `rl:conn_req:${requester.id}`,
        limit,
        CONNECTION_RATE_LIMIT_WINDOW_SECONDS,
        nowMs,
      );
    } catch {
      return errorResponse(503, "rate_limit_unavailable", "Unable to process request right now.");
    }

    if (!rateResult.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil((rateResult.resetAtMs - nowMs) / 1000));
      return errorResponse(
        429,
        "rate_limit_exceeded",
        "Daily connection request limit reached. Please try again later.",
        { retryAfterSeconds },
        { "Retry-After": String(retryAfterSeconds) },
      );
    }

    try {
      const created = await deps.db.createConnectionRequest({
        requesterId: requester.id,
        recipientId: recipient.id,
        icebreakerText: parsed.data.icebreakerText,
      });

      return jsonResponse(
        {
          connectionId: created.id,
          recipientId: recipient.id,
          status: "pending",
          createdAt: created.createdAt,
        },
        201,
      );
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "23505") {
        return errorResponse(
          409,
          "connection_already_exists",
          "A connection request already exists with this neighbor.",
        );
      }
      return errorResponse(500, "create_connection_failed", "Unable to send connection request.");
    }
  };
}
