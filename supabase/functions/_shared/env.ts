import type { AttestationDeps, AttestationMode } from "./attestation.ts";
import { errorResponse } from "./http.ts";
import { createUpstashRedisClient, type UpstashRedisClient } from "./redis.ts";
import { createEdgeDbAdapter, type EdgeDbAdapter } from "./supabase.ts";

export type EdgeRuntimeEnv = {
  db: EdgeDbAdapter;
  redis: UpstashRedisClient;
  attestation: AttestationDeps;
};

function requireEnv(name: string): string {
  const val = Deno.env.get(name)?.trim();
  if (!val) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

export function loadEdgeRuntimeEnv(options: { needAttestation?: boolean } = {}): EdgeRuntimeEnv {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const redisUrl = requireEnv("UPSTASH_REDIS_REST_URL");
  const redisToken = requireEnv("UPSTASH_REDIS_REST_TOKEN");

  const db = createEdgeDbAdapter(supabaseUrl, serviceRoleKey);
  const redis = createUpstashRedisClient(redisUrl, redisToken);

  const rawMode = Deno.env.get("ATTESTATION_MODE")?.trim();
  const mode: AttestationMode = rawMode === "dev_bypass" ? "dev_bypass" : "enforce";
  const rawAppleEnv = Deno.env.get("APPLE_APP_ATTEST_ENV")?.trim();
  const appleEnvironment = rawAppleEnv === "sandbox" ? "sandbox" : "production";

  const attestation: AttestationDeps = {
    redis,
    mode,
    appleAppId: options.needAttestation ? Deno.env.get("APPLE_APP_ID")?.trim() : undefined,
    appleEnvironment,
    googlePackageName: options.needAttestation
      ? Deno.env.get("GOOGLE_PLAY_PACKAGE_NAME")?.trim()
      : undefined,
    googleServiceAccountJson: options.needAttestation
      ? Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")?.trim()
      : undefined,
  };

  return { db, redis, attestation };
}

export function withEdgeErrorBoundary(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch {
      return errorResponse(500, "internal_error", "An unexpected error occurred.");
    }
  };
}
