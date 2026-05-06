import "server-only";

import { serverEnv } from "@/env/server";
import type { Cluster } from "./types";

/**
 * Phase A: env-driven single-cluster registry, keyed as
 * `default`. Phase C swaps to a YAML config file
 * (HYPERCACHE_MONITOR_CLUSTERS) without touching the data layer
 * — the public API of this module stays `getCluster(id)` and
 * `listClusters()`.
 *
 * Multi-cluster URL shape is baked into Phase A on purpose:
 * every proxy route already lives at
 * `/api/clusters/[clusterId]/...`, every TanStack queryKey
 * starts `["cluster", clusterId, ...]`. Adding a second cluster
 * later is a config change, not a refactor.
 */

const DEFAULT_CLUSTER_ID = "default";

const registry: Record<string, Cluster> = {
  [DEFAULT_CLUSTER_ID]: {
    id: DEFAULT_CLUSTER_ID,
    name: "Local cluster",
    apiBaseUrl: serverEnv.HYPERCACHE_API_URL,
    mgmtBaseUrl: serverEnv.HYPERCACHE_MGMT_URL,
  },
};

export function getCluster(id: string): Cluster | undefined {
  return registry[id];
}

export function listClusters(): Cluster[] {
  return Object.values(registry);
}

export { DEFAULT_CLUSTER_ID };
