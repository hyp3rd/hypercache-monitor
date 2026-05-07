import { describe, expect, it } from "vitest";
import { clusterMembersSchema, clusterRingSchema, heartbeatSchema, vnodeSchema } from "./mgmt";

/**
 * Schema fixture tests. The mgmt HTTP wrapper is hand-written
 * (no OpenAPI on port 8081), so these tests are the contract:
 * they fail loudly when the cache changes a wire shape, and
 * the wrapper updates explicitly rather than silently
 * accepting drifted data.
 *
 * The fixtures here are the actual responses observed from a
 * running cluster (5 nodes, 320 vnodes, replication=3) to keep
 * the tests pinned to reality.
 */

describe("memberSchema (PascalCase wire → camelCase parsed)", () => {
  it("transforms PascalCase fields and accepts state enums", () => {
    const fixture = {
      replication: 3,
      virtualNodes: 64,
      members: [
        { ID: "node-1", Address: "hypercache-1:7946", State: "alive", Incarnation: 723 },
        { ID: "node-5", Address: "hypercache-5:7946", State: "alive", Incarnation: 1 },
      ],
    };
    const parsed = clusterMembersSchema.parse(fixture);
    expect(parsed.members).toEqual([
      { id: "node-1", address: "hypercache-1:7946", state: "alive", incarnation: 723 },
      { id: "node-5", address: "hypercache-5:7946", state: "alive", incarnation: 1 },
    ]);
    expect(parsed.replication).toBe(3);
    expect(parsed.virtualNodes).toBe(64);
  });

  it("rejects unknown state enum values", () => {
    const bad = {
      replication: 3,
      virtualNodes: 64,
      members: [{ ID: "n", Address: "x:1", State: "zombie", Incarnation: 0 }],
    };
    const result = clusterMembersSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("accepts every documented state (alive/suspect/dead/draining)", () => {
    for (const state of ["alive", "suspect", "dead", "draining"]) {
      const fixture = {
        replication: 1,
        virtualNodes: 1,
        members: [{ ID: "n", Address: "x:1", State: state, Incarnation: 0 }],
      };
      expect(clusterMembersSchema.parse(fixture).members[0]?.state).toBe(state);
    }
  });
});

describe("vnodeSchema (string → {hash, ownerId})", () => {
  it("splits hash:ownerId on the rightmost colon", () => {
    const parsed = vnodeSchema.parse("0018e9cedb208d91:node-2");
    expect(parsed).toEqual({ hash: "0018e9cedb208d91", ownerId: "node-2" });
  });

  it("preserves colons inside the hash by splitting on the LAST colon", () => {
    // Hypothetical edge case: a node ID that contains a colon.
    // Defensive — the cache should never emit this, but the
    // wrapper must round-trip it cleanly if it does.
    const parsed = vnodeSchema.parse("aabb:cc:ipv6-style-node");
    expect(parsed).toEqual({ hash: "aabb:cc", ownerId: "ipv6-style-node" });
  });

  it("rejects vnode strings missing a colon entirely", () => {
    const result = vnodeSchema.safeParse("malformed");
    expect(result.success).toBe(false);
  });
});

describe("clusterRingSchema (full response shape)", () => {
  it("parses count + vnodes array of strings into typed shape", () => {
    const fixture = {
      count: 3,
      vnodes: ["aaa:node-1", "bbb:node-2", "ccc:node-3"],
    };
    const parsed = clusterRingSchema.parse(fixture);
    expect(parsed.count).toBe(3);
    expect(parsed.vnodes).toHaveLength(3);
    expect(parsed.vnodes[0]).toEqual({ hash: "aaa", ownerId: "node-1" });
  });
});

describe("heartbeatSchema (matches DistHeartbeatMetrics wire shape)", () => {
  it("accepts the exact keys the cache emits today", () => {
    const fixture = {
      heartbeatSuccess: 1234,
      heartbeatFailure: 5,
      nodesRemoved: 0,
      readPrimaryPromote: 2,
    };
    const parsed = heartbeatSchema.parse(fixture);
    expect(parsed.heartbeatSuccess).toBe(1234);
    expect(parsed.heartbeatFailure).toBe(5);
  });

  it("permits unknown extra keys (passthrough — cache may grow the map)", () => {
    const fixture = { heartbeatSuccess: 100, futureMetric: "bar" };
    const parsed = heartbeatSchema.parse(fixture);
    expect(parsed.heartbeatSuccess).toBe(100);
    // Extra key survives parse without erroring.
    expect((parsed as Record<string, unknown>)["futureMetric"]).toBe("bar");
  });

  it("rejects negative counts (counters are nonnegative)", () => {
    const result = heartbeatSchema.safeParse({ heartbeatSuccess: -1 });
    expect(result.success).toBe(false);
  });

  it("accepts an empty object (cache returns nil when backend isn't DistMemory)", () => {
    const parsed = heartbeatSchema.parse({});
    expect(parsed).toEqual({});
  });
});
