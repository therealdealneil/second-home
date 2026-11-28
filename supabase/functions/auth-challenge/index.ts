import { loadEdgeRuntimeEnv, withEdgeErrorBoundary } from "../_shared/env.ts";
import { createAuthChallengeHandler } from "./handler.ts";

Deno.serve(
  withEdgeErrorBoundary((req) => {
    const { db, redis } = loadEdgeRuntimeEnv({ needAttestation: false });
    return createAuthChallengeHandler({ db, redis })(req);
  }),
);
