import "server-only";

import { serverEnv } from "@/env/server";
import { DEFAULT_CLUSTER_ID, loadClusters } from "./loader";
import type { Cluster } from "./types";

/**
 * Cluster registry. Phase C1 switched the backing storage from a
 * hard-coded single-entry map to the YAML loader at `./loader.ts`,
 * with an env-var fallback so single-cluster Phase A / B
 * deployments keep working unchanged.
 *
 * Public API (`getCluster`, `listClusters`, `DEFAULT_CLUSTER_ID`)
 * is unchanged — every existing caller continues to work.
 *
 * Multi-cluster URL shape was baked into the codebase from Phase A:
 * every proxy route lives at `/api/clusters/[clusterId]/...`,
 * every TanStack queryKey starts `["cluster", clusterId, ...]`.
 * Phase C1 just lit it up.
 *
 * Build-phase guard mirrors `src/env/server.ts`: `next build`
 * imports every page module to collect page data, which evaluates
 * this file. The Docker image is built without runtime config —
 * cluster URLs and YAML paths are injected at deploy time — so a
 * fail-fast load here would break the image build. We return an
 * empty registry during the build phase; each production server
 * process re-evaluates this module on startup, at which point real
 * config is present and the loader runs as designed.
 */

const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

const registry: Record<string, Cluster> = isBuildPhase
  ? {}
  : loadClusters({
    clustersPath: serverEnv.HYPERCACHE_MONITOR_CLUSTERS,
    apiUrl: serverEnv.HYPERCACHE_API_URL,
    mgmtUrl: serverEnv.HYPERCACHE_MGMT_URL,
  });

export function getCluster(id: string): Cluster | undefined {
  return registry[id];
}

export function listClusters(): Cluster[] {
  return Object.values(registry);
}

export { DEFAULT_CLUSTER_ID };
