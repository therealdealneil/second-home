import { loadEdgeRuntimeEnv, withEdgeErrorBoundary } from "../_shared/env.ts";
import { createAuthChallengeHandler } from "./handler.ts";

Deno.serve(
  withEdgeErrorBoundary((req) => {
    const { db, redis, attestation } = loadEdgeRuntimeEnv({ needAttestation: true });
    return createAuthChallengeHandler({ db, redis, attestation })(req);
  }),
);
