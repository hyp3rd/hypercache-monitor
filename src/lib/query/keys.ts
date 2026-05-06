/**
 * One canonical query-key shape for every TanStack Query call:
 *
 *     ["cluster", clusterId, surface, ...args]
 *
 * Multi-cluster isolation falls out of this for free — switching
 * the active cluster invalidates exactly its queries without
 * touching others. Phase A only ever hits `clusterId: "default"`.
 *
 * No exceptions: a free-form string array as a queryKey is a
 * forbidden pattern. If a queryKey doesn't fit one of these
 * builders, add a new builder here rather than reinventing.
 */

export const queryKeys = {
  cluster: (clusterId: string) => ["cluster", clusterId] as const,
  members: (clusterId: string) => ["cluster", clusterId, "members"] as const,
  ring: (clusterId: string) => ["cluster", clusterId, "ring"] as const,
  heartbeat: (clusterId: string) => ["cluster", clusterId, "heartbeat"] as const,
  stats: (clusterId: string) => ["cluster", clusterId, "stats"] as const,
  config: (clusterId: string) => ["cluster", clusterId, "config"] as const,
  distMetrics: (clusterId: string) => ["cluster", clusterId, "dist-metrics"] as const,
} as const;
