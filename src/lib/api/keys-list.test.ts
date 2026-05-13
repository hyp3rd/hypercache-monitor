import { describe, expect, it } from "vitest";
import { listKeysResponseSchema } from "./keys-list";

/**
 * Schema fixtures for GET /v1/cache/keys. The shapes mirror
 * what `cmd/hypercache-server/openapi.yaml` documents and what
 * `cmd/hypercache-server/handlers_test.go` pins via
 * `TestHandleListKeys_PrefixAndPaging` — if the cache changes
 * the wire shape, these tests fail loudly.
 */

describe("listKeysResponseSchema", () => {
  it("parses a mid-walk page (next_cursor populated)", () => {
    const wire = {
      keys: ["first-01", "first-02", "first-03"],
      next_cursor: "3",
      total_matched: 50,
      truncated: false,
      node: "node-1",
      partial_nodes: [],
    };
    const parsed = listKeysResponseSchema.parse(wire);
    expect(parsed).toEqual({
      keys: ["first-01", "first-02", "first-03"],
      nextCursor: "3",
      totalMatched: 50,
      truncated: false,
      node: "node-1",
      partialNodes: [],
    });
  });

  it("parses the final page (empty next_cursor signals end of iteration)", () => {
    const wire = {
      keys: ["first-49", "first-50"],
      next_cursor: "",
      total_matched: 50,
      truncated: false,
      node: "node-2",
      partial_nodes: [],
    };
    const parsed = listKeysResponseSchema.parse(wire);
    expect(parsed.nextCursor).toBe("");
    expect(parsed.keys).toHaveLength(2);
  });

  it("parses an empty result (no matching keys)", () => {
    const wire = {
      keys: [],
      next_cursor: "",
      total_matched: 0,
      truncated: false,
      node: "node-1",
      partial_nodes: [],
    };
    const parsed = listKeysResponseSchema.parse(wire);
    expect(parsed.keys).toEqual([]);
    expect(parsed.totalMatched).toBe(0);
  });

  it("parses a truncated result with partial nodes", () => {
    const wire = {
      keys: Array.from({ length: 10 }, (_, i) => `k-${i + 1}`),
      next_cursor: "10",
      total_matched: 10,
      truncated: true,
      node: "node-3",
      partial_nodes: ["node-5"],
    };
    const parsed = listKeysResponseSchema.parse(wire);
    expect(parsed.truncated).toBe(true);
    expect(parsed.partialNodes).toEqual(["node-5"]);
  });

  it("defaults partial_nodes to [] when the backend omits the field", () => {
    // The upstream uses `omitempty` for partial_nodes — happy-path
    // responses don't include the key at all.
    const wire = {
      keys: ["a", "b"],
      next_cursor: "",
      total_matched: 2,
      truncated: false,
      node: "node-1",
    };
    const parsed = listKeysResponseSchema.parse(wire);
    expect(parsed.partialNodes).toEqual([]);
  });

  it("rejects negative total_matched", () => {
    const wire = {
      keys: [],
      next_cursor: "",
      total_matched: -1,
      truncated: false,
      node: "node-1",
    };
    expect(listKeysResponseSchema.safeParse(wire).success).toBe(false);
  });
});
