import { describe, expect, it } from "vitest";
import {
  deleteResponseSchema,
  itemEnvelopeSchema,
  ownersResponseSchema,
  putResponseSchema,
} from "./keys";

/**
 * Schema fixtures for the single-key API. The shapes here
 * mirror what `cmd/hypercache-server/openapi.yaml` documents
 * — when the cache changes a wire shape, these tests fail
 * loudly and the wrapper updates explicitly.
 */

describe("itemEnvelopeSchema", () => {
  it("accepts a fully-populated envelope", () => {
    const fixture = {
      key: "greeting",
      value: "d29ybGQ=",
      value_encoding: "base64" as const,
      ttl_ms: 28412,
      expires_at: "2026-05-06T10:30:00Z",
      version: 1,
      origin: "node-1",
      last_updated: "2026-05-06T10:00:00Z",
      node: "node-1",
      owners: ["node-1", "node-2", "node-3"],
    };
    expect(itemEnvelopeSchema.parse(fixture)).toEqual(fixture);
  });

  it("accepts minimal envelope (no TTL / origin / last_updated)", () => {
    const fixture = {
      key: "k",
      value: "",
      value_encoding: "base64" as const,
      version: 0,
      node: "node-1",
      owners: [],
    };
    expect(itemEnvelopeSchema.parse(fixture).key).toBe("k");
  });

  it("rejects a wrong value_encoding", () => {
    const bad = {
      key: "k",
      value: "",
      value_encoding: "utf8",
      version: 0,
      node: "node-1",
      owners: [],
    };
    expect(itemEnvelopeSchema.safeParse(bad).success).toBe(false);
  });
});

describe("putResponseSchema", () => {
  it("accepts the canonical shape", () => {
    const fixture = {
      key: "k",
      stored: true,
      ttl_ms: 5000,
      bytes: 11,
      node: "node-1",
      owners: ["node-1", "node-2"],
    };
    expect(putResponseSchema.parse(fixture)).toEqual(fixture);
  });

  it("rejects negative bytes", () => {
    expect(
      putResponseSchema.safeParse({
        key: "k",
        stored: true,
        bytes: -1,
        node: "node-1",
        owners: [],
      }).success,
    ).toBe(false);
  });
});

describe("deleteResponseSchema", () => {
  it("accepts the canonical shape", () => {
    expect(
      deleteResponseSchema.parse({
        key: "k",
        deleted: true,
        node: "n",
        owners: ["n"],
      }),
    ).toBeTruthy();
  });
});

describe("ownersResponseSchema", () => {
  it("accepts the canonical shape", () => {
    expect(
      ownersResponseSchema.parse({
        key: "k",
        owners: ["a", "b", "c"],
        node: "a",
      }),
    ).toBeTruthy();
  });
});
