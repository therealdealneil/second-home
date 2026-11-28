import { loadEdgeRuntimeEnv, withEdgeErrorBoundary } from "../_shared/env.ts";
import { createJoinHouseholdHandler } from "./handler.ts";

Deno.serve(
  withEdgeErrorBoundary((req) => {
    const { db, redis, attestation } = loadEdgeRuntimeEnv({ needAttestation: true });
    return createJoinHouseholdHandler({ db, redis, attestation })(req);
  }),
);
