import { z } from "zod";
import { registerAppleAppAttestKey, type AttestationDeps } from "../_shared/attestation.ts";
import {
  errorResponse,
  extractBearerToken,
  handleCorsPreflight,
  jsonResponse,
  parseJsonBody,
} from "../_shared/http.ts";
import type { UpstashRedisClient } from "../_shared/redis.ts";
import type { EdgeDbAdapter } from "../_shared/supabase.ts";
import { AUTH_NONCE_TTL_SECONDS } from "../_shared/validation.ts";

export type AuthChallengeDeps = {
  db: Pick<EdgeDbAdapter, "getAuthUser">;
  redis: UpstashRedisClient;
  attestation?: AttestationDeps;
  nowMs?: () => number;
};

const EmptyChallengeBodySchema = z.object({}).strict();

const RegisterAppleKeySchema = z
  .object({
    action: z.literal("register_apple_key"),
    keyId: z.string().trim().min(1).max(256),
    attestationObject: z.string().trim().min(1).max(32_768),
    nonce: z.string().trim().min(16).max(128),
  })
  .strict();

function generateRandomNonceHex(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createAuthChallengeHandler(deps: AuthChallengeDeps) {
  return async function handleAuthChallenge(req: Request): Promise<Response> {
    const preflight = handleCorsPreflight(req);
    if (preflight) {
      return preflight;
    }

    if (req.method !== "GET" && req.method !== "POST") {
      return errorResponse(405, "method_not_allowed", "Method not allowed.");
    }

    const token = extractBearerToken(req);
    if (!token) {
      return errorResponse(401, "unauthorized", "Authentication required.");
    }

    let user: Awaited<ReturnType<typeof deps.db.getAuthUser>>;
    try {
      user = await deps.db.getAuthUser(token);
    } catch {
      return errorResponse(503, "service_unavailable", "Unable to verify session.");
    }

    if (!user) {
      return errorResponse(401, "unauthorized", "Invalid or expired session.");
    }

    if (req.method === "POST") {
      const contentType = req.headers.get("content-type") ?? "";
      if (contentType.toLowerCase().includes("application/json")) {
        const bodyResult = await parseJsonBody(req);
        if (!bodyResult.ok) {
          return bodyResult.response;
        }
        if (EmptyChallengeBodySchema.safeParse(bodyResult.data).success) {
          // Empty `{}` POST requests issue a challenge nonce
        } else {
          const parsed = RegisterAppleKeySchema.safeParse(bodyResult.data);
          if (!parsed.success) {
            return errorResponse(400, "invalid_request", "Invalid Apple key enrollment payload.");
          }
          if (!deps.attestation) {
            return errorResponse(
              503,
              "attestation_unavailable",
              "Key enrollment is not configured.",
            );
          }
          const regResult = await registerAppleAppAttestKey({
            userId: user.id,
            keyId: parsed.data.keyId,
            attestationObjectBase64: parsed.data.attestationObject,
            nonce: parsed.data.nonce,
            deps: deps.attestation,
          });
          if (!regResult.ok) {
            return errorResponse(regResult.status, regResult.error, regResult.message);
          }
          return jsonResponse({ registered: true, keyId: parsed.data.keyId }, 201);
        }
      }
    }

    const nonce = generateRandomNonceHex(32);
    const nowMs = (deps.nowMs ?? Date.now)();
    const expiresAt = new Date(nowMs + AUTH_NONCE_TTL_SECONDS * 1000).toISOString();

    try {
      await deps.redis.setEx(`auth_nonce:${user.id}:${nonce}`, AUTH_NONCE_TTL_SECONDS, "1");
    } catch {
      return errorResponse(503, "challenge_unavailable", "Unable to issue challenge nonce.");
    }

    return jsonResponse(
      {
        nonce,
        expiresInSeconds: AUTH_NONCE_TTL_SECONDS,
        expiresAt,
      },
      200,
    );
  };
}
