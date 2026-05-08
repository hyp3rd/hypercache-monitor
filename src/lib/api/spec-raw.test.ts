import { describe, expect, it, vi } from "vitest";

// `spec-raw.ts` imports the cluster registry, which transitively
// imports the env validator at module load. Mock the registry so
// the module loads without env vars set — same pattern the
// proxy / spec tests use.
vi.mock("@/lib/clusters/registry", () => ({
  getCluster: vi.fn(),
  DEFAULT_CLUSTER_ID: "default",
  listClusters: vi.fn(() => []),
}));

const { filterToSafeMethods } = await import("./spec-raw");

/**
 * Pins the safe-methods filter — the security-critical part of
 * Phase B5's design. A regression that lets POST/PUT/DELETE
 * through to the Scalar renderer would expose Try-It-Out for
 * destructive operations, defeating the explicit choice to keep
 * write surfaces gated by the Bulk + Inspector pages.
 */

describe("filterToSafeMethods", () => {
  it("drops POST, PUT, PATCH, DELETE operations", () => {
    const spec = {
      openapi: "3.1.0",
      paths: {
        "/x": {
          get: { summary: "read x" },
          post: { summary: "create x" },
          put: { summary: "replace x" },
          patch: { summary: "update x" },
          delete: { summary: "remove x" },
        },
      },
    };
    const out = filterToSafeMethods(spec);
    const path = (out.paths as Record<string, Record<string, unknown>>)["/x"]!;
    expect(path).toBeDefined();
    expect(path.get).toBeDefined();
    expect(path.post).toBeUndefined();
    expect(path.put).toBeUndefined();
    expect(path.patch).toBeUndefined();
    expect(path.delete).toBeUndefined();
  });

  it("preserves GET, HEAD, OPTIONS, TRACE operations", () => {
    const spec = {
      openapi: "3.1.0",
      paths: {
        "/x": {
          get: { summary: "read" },
          head: { summary: "head" },
          options: { summary: "options" },
          trace: { summary: "trace" },
        },
      },
    };
    const out = filterToSafeMethods(spec);
    const path = (out.paths as Record<string, Record<string, unknown>>)["/x"]!;
    expect(Object.keys(path).sort()).toEqual(["get", "head", "options", "trace"]);
  });

  it("preserves path-level metadata fields (parameters, summary, description, servers)", () => {
    const spec = {
      openapi: "3.1.0",
      paths: {
        "/x": {
          summary: "X resource",
          description: "Top-level docs",
          parameters: [{ name: "limit", in: "query" }],
          servers: [{ url: "/v1" }],
          get: { summary: "read" },
          post: { summary: "create" },
        },
      },
    };
    const out = filterToSafeMethods(spec);
    const path = (out.paths as Record<string, Record<string, unknown>>)["/x"]!;
    expect(path.summary).toBe("X resource");
    expect(path.description).toBe("Top-level docs");
    expect(path.parameters).toEqual([{ name: "limit", in: "query" }]);
    expect(path.servers).toEqual([{ url: "/v1" }]);
    expect(path.post).toBeUndefined();
  });

  it("removes paths whose only operations were write methods", () => {
    const spec = {
      openapi: "3.1.0",
      paths: {
        "/read-only": { get: { summary: "ok" } },
        "/write-only": { post: { summary: "create" } },
        "/write-and-delete": { put: { summary: "replace" }, delete: { summary: "remove" } },
      },
    };
    const out = filterToSafeMethods(spec);
    const paths = out.paths as Record<string, unknown>;
    expect(paths["/read-only"]).toBeDefined();
    expect(paths["/write-only"]).toBeUndefined();
    expect(paths["/write-and-delete"]).toBeUndefined();
  });

  it("does not mutate the input (defensive deep clone)", () => {
    const spec = {
      openapi: "3.1.0",
      paths: { "/x": { get: { summary: "read" }, post: { summary: "create" } } },
    };
    const before = JSON.stringify(spec);
    filterToSafeMethods(spec);
    expect(JSON.stringify(spec)).toBe(before);
  });

  it("treats method names case-insensitively", () => {
    const spec = {
      openapi: "3.1.0",
      paths: {
        "/x": {
          GET: { summary: "uppercase get is still safe" },
          POST: { summary: "uppercase post should be filtered" },
        },
      },
    };
    const out = filterToSafeMethods(spec);
    const path = (out.paths as Record<string, Record<string, unknown>>)["/x"]!;
    expect(path.GET).toBeDefined();
    expect(path.POST).toBeUndefined();
  });

  it("returns the spec unchanged when paths is missing or non-object", () => {
    const noPaths = { openapi: "3.1.0" };
    expect(filterToSafeMethods(noPaths)).toEqual(noPaths);

    const stringPaths = { openapi: "3.1.0", paths: "not-an-object" };
    expect(filterToSafeMethods(stringPaths)).toEqual(stringPaths);
  });
});
