import { describe, expect, it } from "vitest";
import { configSchema, distMetricsSchema, statsSchema } from "./metrics";

/**
 * Fixture-driven schema tests. The wire shapes here are copied
 * verbatim from a live cluster's responses (`curl :8081/config`,
 * `:8081/stats`, `:8081/dist/metrics`) so a Go-side rename
 * surfaces here as a parse failure rather than UI breakage.
 */

describe("configSchema", () => {
  it("parses the single-node minimal shape (no dist fields)", () => {
    const wire = {
      capacity: 1000,
      allocation: 12345,
      maxCacheSize: 0,
      evictionInterval: "30s",
      expirationInterval: "5m0s",
      evictionAlgorithm: "lru",
    };
    const parsed = configSchema.parse(wire);
    expect(parsed.capacity).toBe(1000);
    expect(parsed.replication).toBeUndefined();
    expect(parsed.virtualNodesPerNode).toBeUndefined();
  });

  it("parses the distributed shape with replication + vnodes", () => {
    const parsed = configSchema.parse({
      capacity: 5000,
      allocation: 67890,
      maxCacheSize: 1024 * 1024,
      evictionInterval: "1m0s",
      expirationInterval: "10m0s",
      evictionAlgorithm: "lfu",
      replication: 3,
      virtualNodesPerNode: 64,
    });
    expect(parsed.replication).toBe(3);
    expect(parsed.virtualNodesPerNode).toBe(64);
  });

  it("rejects negative allocation", () => {
    expect(() =>
      configSchema.parse({
        capacity: 100,
        allocation: -1,
        maxCacheSize: 0,
        evictionInterval: "30s",
        expirationInterval: "5m",
        evictionAlgorithm: "lru",
      }),
    ).toThrow();
  });
});

describe("statsSchema", () => {
  it("parses a populated dynamic-keys map", () => {
    const wire = {
      "cache.get": {
        Mean: 1.5,
        Median: 1,
        Min: 0,
        Max: 5,
        Count: 100,
        Sum: 150,
        Variance: 0.25,
      },
      "cache.set": {
        Mean: 2.1,
        Median: 2,
        Min: 1,
        Max: 8,
        Count: 50,
        Sum: 105,
        Variance: 0.5,
      },
    };
    const parsed = statsSchema.parse(wire);
    expect(Object.keys(parsed)).toEqual(["cache.get", "cache.set"]);
    expect(parsed["cache.get"]?.Mean).toBe(1.5);
  });

  it("parses an empty map (no metrics registered yet)", () => {
    expect(statsSchema.parse({})).toEqual({});
  });

  it("accepts Min/Max/Sum beyond 2^53 (Go int64 nanosecond durations)", () => {
    // `eviction_loop_duration` and friends carry int64 nanos that
    // routinely exceed JavaScript's safe-integer range. The wire
    // shape is what the cache returns; we accept the precision
    // loss rather than rejecting the parse. Regression guard
    // against re-tightening `Min`/`Max`/`Sum` to `.int()`.
    const wire = {
      eviction_loop_duration: {
        Mean: 1_500_000.5,
        Median: 1_400_000,
        Min: 9_223_372_036_854_775_000, // > 2^53
        Max: 9_223_372_036_854_775_807, // int64 max
        Count: 1_000_000,
        Sum: -9_223_372_036_854_775_000, // counter overflow surface (still parses)
        Variance: 1.5e12,
      },
    };
    expect(() => statsSchema.parse(wire)).not.toThrow();
  });
});

const distMetricsFixture = {
  ForwardGet: 100,
  ForwardSet: 50,
  ForwardRemove: 5,
  ReplicaFanoutSet: 150,
  ReplicaFanoutRemove: 15,
  ReplicaGetMiss: 3,
  ReadRepair: 2,
  HeartbeatSuccess: 5000,
  HeartbeatFailure: 12,
  IndirectProbeSuccess: 4,
  IndirectProbeFailure: 1,
  IndirectProbeRefuted: 0,
  WriteAcks: 200,
  WriteAttempts: 200,
  WriteQuorumFailures: 0,
  Drains: 0,
  NodesSuspect: 1,
  NodesDead: 0,
  NodesRemoved: 0,
  VersionConflicts: 7,
  VersionTieBreaks: 2,
  ReadPrimaryPromote: 1,
  MembershipVersion: 42,
  MembersAlive: 4,
  MembersSuspect: 1,
  MembersDead: 0,
  HintedQueued: 30,
  HintedReplayed: 25,
  HintedExpired: 0,
  HintedDropped: 1,
  HintedGlobalDropped: 0,
  HintedBytes: 4096,
  MerkleSyncs: 10,
  MerkleKeysPulled: 8,
  MerkleBuildNanos: 1_500_000,
  MerkleDiffNanos: 800_000,
  MerkleFetchNanos: 2_000_000,
  AutoSyncLoops: 50,
  LastAutoSyncNanos: 5_000_000,
  LastAutoSyncError: "",
  TombstonesActive: 12,
  TombstonesPurged: 88,
  RebalancedKeys: 100,
  RebalanceBatches: 5,
  RebalanceThrottle: 1,
  RebalanceLastNanos: 1_500_000,
  RebalancedReplicaDiff: 30,
  RebalanceReplicaDiffThrottle: 0,
  RebalancedPrimary: 70,
};

describe("distMetricsSchema", () => {
  it("transforms PascalCase wire fields to camelCase", () => {
    const parsed = distMetricsSchema.parse(distMetricsFixture);
    expect(parsed.forwardGet).toBe(100);
    expect(parsed.heartbeatSuccess).toBe(5000);
    expect(parsed.lastAutoSyncError).toBe("");
    expect(parsed.membershipVersion).toBe(42);
  });

  it("preserves zero values rather than dropping them", () => {
    const parsed = distMetricsSchema.parse({
      ...distMetricsFixture,
      ForwardGet: 0,
    });
    expect(parsed.forwardGet).toBe(0);
  });

  it("preserves the LastAutoSyncError string when present", () => {
    const parsed = distMetricsSchema.parse({
      ...distMetricsFixture,
      LastAutoSyncError: "merkle peer 192.0.2.5:7950 unreachable",
    });
    expect(parsed.lastAutoSyncError).toBe(
      "merkle peer 192.0.2.5:7950 unreachable",
    );
  });

  it("rejects negative counters (catches client/server clock-skew bugs)", () => {
    expect(() =>
      distMetricsSchema.parse({ ...distMetricsFixture, ForwardGet: -1 }),
    ).toThrow();
  });

  it("rejects responses missing fields rather than silently defaulting", () => {
    const partial = { ...distMetricsFixture } as Partial<
      typeof distMetricsFixture
    >;
    delete partial.HeartbeatSuccess;
    expect(() => distMetricsSchema.parse(partial)).toThrow();
  });
});
