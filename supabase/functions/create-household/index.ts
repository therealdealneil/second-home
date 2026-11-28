import { latLngToCell } from "h3-js";
import { loadEdgeRuntimeEnv, withEdgeErrorBoundary } from "../_shared/env.ts";
import { createCreateHouseholdHandler } from "./handler.ts";

Deno.serve(
  withEdgeErrorBoundary((req) => {
    const { db, redis, attestation } = loadEdgeRuntimeEnv({ needAttestation: true });
    return createCreateHouseholdHandler({
      db,
      redis,
      attestation,
      latLngToH3Res7: (lat, lng) => latLngToCell(lat, lng, 7),
    })(req);
  }),
);
