import { describe, expect, it, vi } from "vitest";

// `spec.ts` imports `@/lib/clusters/registry`, which imports the
// env validator at module load. Without env vars set the validator
// throws. We mock the registry so the import chain never reaches
// the validator — same shape `proxy.test.ts` uses.
vi.mock("@/lib/clusters/registry", () => ({
  getCluster: vi.fn(),
  DEFAULT_CLUSTER_ID: "default",
  listClusters: vi.fn(() => []),
}));

const { specSchema, securitySchemeSchema } = await import("./spec");

/**
 * Schema-only tests. The `fetchSpec` runtime function goes
 * through `fetch()` and the cluster registry; it's exercised
 * end-to-end by the auth-info page test + E2E scenario, so
 * we don't reproduce the network mocking here.
 */

describe("specSchema", () => {
  it("parses the cache's actual OpenAPI shape (verbatim slice)", () => {
    const raw = {
      openapi: "3.1.0",
      info: { title: "HyperCache", version: "1.0.0" },
      servers: [{ url: "/v1", description: "Same-origin client API" }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "opaque-token",
            description: "Bearer token; constant-time compared.",
          },
        },
      },
    };
    const parsed = specSchema.parse(raw);
    expect(parsed.info.title).toBe("HyperCache");
    expect(parsed.components?.securitySchemes?.bearerAuth?.scheme).toBe(
      "bearer",
    );
  });

  it("preserves unknown securityScheme fields (passthrough)", () => {
    const parsed = securitySchemeSchema.parse({
      type: "http",
      scheme: "bearer",
      "x-custom": "future-cache-extension",
    });
    expect((parsed as Record<string, unknown>)["x-custom"]).toBe(
      "future-cache-extension",
    );
  });

  it("treats missing components.securitySchemes as undefined (single-node demo cluster)", () => {
    const parsed = specSchema.parse({
      openapi: "3.1.0",
      info: { title: "HyperCache", version: "1.0.0" },
    });
    expect(parsed.components).toBeUndefined();
  });

  it("rejects responses missing the required openapi version field", () => {
    expect(() =>
      specSchema.parse({ info: { title: "HyperCache", version: "1.0.0" } }),
    ).toThrow();
  });
});
