import { loadEdgeRuntimeEnv, withEdgeErrorBoundary } from "../_shared/env.ts";
import { createSendConnectionRequestHandler } from "./handler.ts";

Deno.serve(
  withEdgeErrorBoundary((req) => {
    const { db, redis, attestation } = loadEdgeRuntimeEnv({ needAttestation: true });
    return createSendConnectionRequestHandler({ db, redis, attestation })(req);
  }),
);
