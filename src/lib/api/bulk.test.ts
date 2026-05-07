import { describe, expect, it } from "vitest";
import { batchDeleteResponseSchema, batchGetResponseSchema, batchPutResponseSchema } from "./bulk";

/**
 * Schema-only tests for the batch wrappers. The fetcher
 * functions go through `fetch()` and are exercised by the
 * page-level component tests + E2E suite — we don't duplicate
 * happy-path mocking here.
 *
 * The shapes are the contract with `cmd/hypercache-server/main.go`.
 * If a Go-side rename lands, these tests fail loud rather than
 * letting a silent shape drift sneak past code review.
 */

describe("batchGetResponseSchema", () => {
  it("parses a mixed found/missing response", () => {
    const parsed = batchGetResponseSchema.parse({
      node: "node-1",
      results: [
        {
          key: "k1",
          found: true,
          value: "aGVsbG8=",
          value_encoding: "base64",
          ttl_ms: 30_000,
          version: 1,
          owners: ["node-1", "node-2"],
        },
        { key: "missing", found: false },
      ],
    });
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0]?.found).toBe(true);
    expect(parsed.results[1]?.found).toBe(false);
  });

  it("preserves unknown fields on results (passthrough)", () => {
    // Forward-compat: a future Go-side field should not break
    // the parse. Operators see the field via the raw object even
    // if the typed UI doesn't render it yet.
    const parsed = batchGetResponseSchema.parse({
      node: "node-1",
      results: [{ key: "k1", found: false, future_field: "ignored" }],
    });
    expect((parsed.results[0] as Record<string, unknown>).future_field).toBe("ignored");
  });
});

describe("batchPutResponseSchema", () => {
  it("parses a mixed stored/failed response", () => {
    const parsed = batchPutResponseSchema.parse({
      node: "node-1",
      results: [
        { key: "k1", stored: true, bytes: 5, owners: ["node-1"] },
        { key: "", stored: false, error: "missing key", code: "BAD_REQUEST" },
      ],
    });
    expect(parsed.results[0]?.stored).toBe(true);
    expect(parsed.results[1]?.stored).toBe(false);
    expect(parsed.results[1]?.code).toBe("BAD_REQUEST");
  });

  it("rejects results missing the required `stored` boolean", () => {
    expect(() =>
      batchPutResponseSchema.parse({
        node: "node-1",
        results: [{ key: "k1" }],
      }),
    ).toThrow();
  });
});

describe("batchDeleteResponseSchema", () => {
  it("parses a happy-path response", () => {
    const parsed = batchDeleteResponseSchema.parse({
      node: "node-1",
      results: [
        { key: "k1", deleted: true, owners: ["node-1"] },
        { key: "k2", deleted: true },
      ],
    });
    expect(parsed.results.every((r) => r.deleted)).toBe(true);
  });

  it("parses a failed-delete result with error/code", () => {
    const parsed = batchDeleteResponseSchema.parse({
      node: "node-1",
      results: [{ key: "x", deleted: false, error: "remove failed: timeout", code: "UPSTREAM" }],
    });
    expect(parsed.results[0]?.deleted).toBe(false);
    expect(parsed.results[0]?.code).toBe("UPSTREAM");
  });
});
