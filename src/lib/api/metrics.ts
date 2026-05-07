import { z } from "zod";
import { fetchMgmt } from "./mgmt";

/**
 * Zod schemas + fetchers for the cache's observability surface
 * — `/stats`, `/config`, `/dist/metrics` on the management HTTP
 * port (8081). These three feed the Phase B2 Metrics dashboard.
 *
 * Like `mgmt.ts`, the schemas mirror the Go side verbatim and
 * normalize PascalCase wire fields into camelCase via `transform`.
 * Counter-style cumulative integers stay as `number` — JavaScript
 * loses precision past 2^53 (~9.0e15) but the Go side uses int64
 * and counters are unlikely to cross that horizon for a control
 * panel observation window. If they do, we revisit with `bigint`.
 *
 * Why these live separately from `mgmt.ts`: the Phase A wrapper
 * is ~150 LOC and concerned with cluster topology
 * (members/ring/heartbeat). Folding the ~45-field DistMetrics
 * schema in there bloats the file beyond comfortable review;
 * splitting on the surface-area boundary keeps both files focused.
 */

// ---- /config ---------------------------------------------------

/**
 * `/config` is a flat map populated server-side in
 * `management_http.go::registerBasic`. Distributed-only fields
 * (`replication`, `virtualNodesPerNode`) only appear when the
 * underlying backend implements `membershipIntrospect`, so we
 * mark them optional — a single-node cache returns just the
 * core six.
 */
export const configSchema = z.object({
  capacity: z.number().int().nonnegative(),
  allocation: z.number().int().nonnegative(),
  maxCacheSize: z.number().int().nonnegative(),
  evictionInterval: z.string(), // Go duration — operator-facing string ("30s", "5m0s")
  expirationInterval: z.string(),
  evictionAlgorithm: z.string(),
  replication: z.number().int().positive().optional(),
  virtualNodesPerNode: z.number().int().positive().optional(),
});
export type CacheConfig = z.infer<typeof configSchema>;

// ---- /stats ----------------------------------------------------

/**
 * `/stats` returns `Record<string, Stat>` — a dynamic-keys map
 * where each key is a metric name (registered by middleware via
 * `WithStatsCollector`) and the value is the running statistical
 * summary defined in `pkg/stats/stats.go`.
 *
 * `Values` is intentionally NOT included here. The cache emits
 * the full sample buffer per metric, which can run to thousands
 * of values per request — the dashboard works fine with the
 * pre-aggregated Mean/Median/Min/Max/Sum/Count and skipping
 * `Values` saves bandwidth + DOM render cost.
 *
 * `Min`, `Max`, `Sum` are `z.number()` rather than `z.number().int()`
 * by deliberate choice. The cache stores them as Go `int64`, and
 * for duration-tracking metrics (e.g. `eviction_loop_duration`
 * measured in nanoseconds) the values routinely exceed JavaScript's
 * safe-integer range (2^53 ≈ 9e15). Accepting the precision loss
 * is consistent with how `DistMetrics` handles its int64 counters
 * — operators see the right magnitude via `.toLocaleString()`,
 * and the last few digits at quintillion scale don't matter for
 * a dashboard. `Count` keeps `.int().nonnegative()` since it's
 * a sample count that won't realistically reach 2^53.
 */
export const statSchema = z.object({
  Mean: z.number(),
  Median: z.number(),
  Min: z.number(),
  Max: z.number(),
  Count: z.number().int().nonnegative(),
  Sum: z.number(),
  Variance: z.number(),
});
export type Stat = z.infer<typeof statSchema>;

export const statsSchema = z.record(z.string(), statSchema);
export type Stats = z.infer<typeof statsSchema>;

// ---- /dist/metrics --------------------------------------------

/**
 * `DistMetrics` from `pkg/backend/dist_memory.go` — the canonical
 * snapshot of the distributed backend's cumulative counters and
 * gauges. The Go struct has no `json:` tags so wire field names
 * are PascalCase; we normalize to camelCase on the parse step
 * for idiomatic UI consumption.
 *
 * Field grouping (drives the dashboard card layout):
 *
 *   - traffic: forwarding + replica fanout + replica miss
 *   - reliability: heartbeat + indirect probe + write quorum
 *   - repair / drift: read repair, merkle, auto-sync,
 *     tombstones, version conflicts/tie-breaks, primary promote
 *   - membership: version, alive/suspect/dead counts, drains,
 *     nodes removed
 *   - hinted handoff: queued/replayed/expired/dropped/bytes
 *   - rebalance: keys / batches / throttle / nanos / replica diff
 *
 * Every counter is `int64` server-side. We accept it as `number`
 * (see the JS-precision note at the top) and validate
 * non-negativity except for `LastAutoSyncNanos` (a duration that
 * can be 0 when no sync has run).
 */
const distMetricsWireSchema = z.object({
  // traffic
  ForwardGet: z.number().int().nonnegative(),
  ForwardSet: z.number().int().nonnegative(),
  ForwardRemove: z.number().int().nonnegative(),
  ReplicaFanoutSet: z.number().int().nonnegative(),
  ReplicaFanoutRemove: z.number().int().nonnegative(),
  ReplicaGetMiss: z.number().int().nonnegative(),
  // reliability
  ReadRepair: z.number().int().nonnegative(),
  HeartbeatSuccess: z.number().int().nonnegative(),
  HeartbeatFailure: z.number().int().nonnegative(),
  IndirectProbeSuccess: z.number().int().nonnegative(),
  IndirectProbeFailure: z.number().int().nonnegative(),
  IndirectProbeRefuted: z.number().int().nonnegative(),
  WriteAcks: z.number().int().nonnegative(),
  WriteAttempts: z.number().int().nonnegative(),
  WriteQuorumFailures: z.number().int().nonnegative(),
  // membership / drift
  Drains: z.number().int().nonnegative(),
  NodesSuspect: z.number().int().nonnegative(),
  NodesDead: z.number().int().nonnegative(),
  NodesRemoved: z.number().int().nonnegative(),
  VersionConflicts: z.number().int().nonnegative(),
  VersionTieBreaks: z.number().int().nonnegative(),
  ReadPrimaryPromote: z.number().int().nonnegative(),
  MembershipVersion: z.number().int().nonnegative(),
  MembersAlive: z.number().int().nonnegative(),
  MembersSuspect: z.number().int().nonnegative(),
  MembersDead: z.number().int().nonnegative(),
  // hinted handoff
  HintedQueued: z.number().int().nonnegative(),
  HintedReplayed: z.number().int().nonnegative(),
  HintedExpired: z.number().int().nonnegative(),
  HintedDropped: z.number().int().nonnegative(),
  HintedGlobalDropped: z.number().int().nonnegative(),
  HintedBytes: z.number().int().nonnegative(),
  // merkle / auto-sync / tombstones
  MerkleSyncs: z.number().int().nonnegative(),
  MerkleKeysPulled: z.number().int().nonnegative(),
  MerkleBuildNanos: z.number().int().nonnegative(),
  MerkleDiffNanos: z.number().int().nonnegative(),
  MerkleFetchNanos: z.number().int().nonnegative(),
  AutoSyncLoops: z.number().int().nonnegative(),
  LastAutoSyncNanos: z.number().int().nonnegative(),
  LastAutoSyncError: z.string(),
  TombstonesActive: z.number().int().nonnegative(),
  TombstonesPurged: z.number().int().nonnegative(),
  // rebalance
  RebalancedKeys: z.number().int().nonnegative(),
  RebalanceBatches: z.number().int().nonnegative(),
  RebalanceThrottle: z.number().int().nonnegative(),
  RebalanceLastNanos: z.number().int().nonnegative(),
  RebalancedReplicaDiff: z.number().int().nonnegative(),
  RebalanceReplicaDiffThrottle: z.number().int().nonnegative(),
  RebalancedPrimary: z.number().int().nonnegative(),
});

export const distMetricsSchema = distMetricsWireSchema.transform((m) => ({
  // traffic
  forwardGet: m.ForwardGet,
  forwardSet: m.ForwardSet,
  forwardRemove: m.ForwardRemove,
  replicaFanoutSet: m.ReplicaFanoutSet,
  replicaFanoutRemove: m.ReplicaFanoutRemove,
  replicaGetMiss: m.ReplicaGetMiss,
  // reliability
  readRepair: m.ReadRepair,
  heartbeatSuccess: m.HeartbeatSuccess,
  heartbeatFailure: m.HeartbeatFailure,
  indirectProbeSuccess: m.IndirectProbeSuccess,
  indirectProbeFailure: m.IndirectProbeFailure,
  indirectProbeRefuted: m.IndirectProbeRefuted,
  writeAcks: m.WriteAcks,
  writeAttempts: m.WriteAttempts,
  writeQuorumFailures: m.WriteQuorumFailures,
  // membership / drift
  drains: m.Drains,
  nodesSuspect: m.NodesSuspect,
  nodesDead: m.NodesDead,
  nodesRemoved: m.NodesRemoved,
  versionConflicts: m.VersionConflicts,
  versionTieBreaks: m.VersionTieBreaks,
  readPrimaryPromote: m.ReadPrimaryPromote,
  membershipVersion: m.MembershipVersion,
  membersAlive: m.MembersAlive,
  membersSuspect: m.MembersSuspect,
  membersDead: m.MembersDead,
  // hinted handoff
  hintedQueued: m.HintedQueued,
  hintedReplayed: m.HintedReplayed,
  hintedExpired: m.HintedExpired,
  hintedDropped: m.HintedDropped,
  hintedGlobalDropped: m.HintedGlobalDropped,
  hintedBytes: m.HintedBytes,
  // merkle / auto-sync / tombstones
  merkleSyncs: m.MerkleSyncs,
  merkleKeysPulled: m.MerkleKeysPulled,
  merkleBuildNanos: m.MerkleBuildNanos,
  merkleDiffNanos: m.MerkleDiffNanos,
  merkleFetchNanos: m.MerkleFetchNanos,
  autoSyncLoops: m.AutoSyncLoops,
  lastAutoSyncNanos: m.LastAutoSyncNanos,
  lastAutoSyncError: m.LastAutoSyncError,
  tombstonesActive: m.TombstonesActive,
  tombstonesPurged: m.TombstonesPurged,
  // rebalance
  rebalancedKeys: m.RebalancedKeys,
  rebalanceBatches: m.RebalanceBatches,
  rebalanceThrottle: m.RebalanceThrottle,
  rebalanceLastNanos: m.RebalanceLastNanos,
  rebalancedReplicaDiff: m.RebalancedReplicaDiff,
  rebalanceReplicaDiffThrottle: m.RebalanceReplicaDiffThrottle,
  rebalancedPrimary: m.RebalancedPrimary,
}));
export type DistMetrics = z.infer<typeof distMetricsSchema>;

// ---- Fetchers --------------------------------------------------

export function fetchConfig(clusterId: string, init?: RequestInit): Promise<CacheConfig> {
  return fetchMgmt(clusterId, "config", configSchema, init);
}

export function fetchStats(clusterId: string, init?: RequestInit): Promise<Stats> {
  return fetchMgmt(clusterId, "stats", statsSchema, init);
}

export function fetchDistMetrics(clusterId: string, init?: RequestInit): Promise<DistMetrics> {
  return fetchMgmt(clusterId, "dist/metrics", distMetricsSchema, init);
}
