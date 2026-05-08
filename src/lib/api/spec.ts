import { getCluster } from "@/lib/clusters/registry";
import { load } from "js-yaml";
import "server-only";
import { z } from "zod";

/**
 * Server-side fetcher + zod-validated projection of the cache's
 * OpenAPI 3.x spec. Used by the Phase B4 Auth Posture surface to
 * render `securitySchemes` for operator audit.
 *
 * Why fetch directly from `cluster.apiBaseUrl` instead of the
 * Next proxy: this code only runs in server components, so the
 * CORS/XSS reasoning that mandates the proxy for browser code
 * does not apply. The spec endpoint is auth-free on the cache
 * side ([cmd/hypercache-server/main.go::registerOpenAPI]) so we
 * also skip the bearer-token plumbing — operators viewing the
 * Auth Posture page may have no scopes that would let the
 * proxy through to the spec endpoint anyway.
 *
 * Why YAML instead of JSON: the cache only emits the `.yaml`
 * variant (no .json route registered); see openapi.go in the
 * cache repo. js-yaml is the canonical Node parser; ~15KB
 * gzipped and behind a server-only import so it never reaches
 * the client bundle.
 *
 * Why a typed projection rather than `unknown`: the spec is
 * large (~700 lines) and the page only renders a tiny subset.
 * Zod-validating the slice we actually use makes a Go-side
 * field rename loud, surfaces here at fetch time rather than as
 * a render error, and keeps the consumer code free of optional
 * chaining noise.
 */

// ---- Schemas ---------------------------------------------------------

export const securitySchemeSchema = z
  .object({
    type: z.string(),
    scheme: z.string().optional(),
    bearerFormat: z.string().optional(),
    description: z.string().optional(),
    in: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();
export type SecurityScheme = z.infer<typeof securitySchemeSchema>;

export const specInfoSchema = z.object({
  title: z.string(),
  version: z.string(),
  description: z.string().optional(),
});

export const specServerSchema = z.object({
  url: z.string(),
  description: z.string().optional(),
});

/**
 * Top-level slice. Permissive `passthrough` on `info` and
 * `components` so a cache-side spec extension doesn't break the
 * parse — only the fields the UI actually reads are pinned.
 */
export const specSchema = z.object({
  openapi: z.string(),
  info: specInfoSchema,
  servers: z.array(specServerSchema).optional(),
  components: z
    .object({
      securitySchemes: z.record(z.string(), securitySchemeSchema).optional(),
    })
    .passthrough()
    .optional(),
});
export type CacheSpec = z.infer<typeof specSchema>;

// ---- Fetcher ---------------------------------------------------------

export class SpecFetchError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "SpecFetchError";
  }
}

/**
 * Fetches and parses the OpenAPI YAML for the supplied cluster.
 * Server-component-only — the YAML parse pulls in js-yaml which
 * we don't want shipping to the browser.
 *
 * Caches via Next's data-cache for 60s — the spec is effectively
 * static within a deployment and refreshing more aggressively
 * would just hit the cache pointlessly on every navigation to
 * /auth-info.
 */
export async function fetchSpec(clusterId: string): Promise<CacheSpec> {
  const cluster = getCluster(clusterId);
  if (cluster === undefined) {
    throw new SpecFetchError(`unknown cluster id: ${clusterId}`);
  }

  const url = new URL("/v1/openapi.yaml", cluster.apiBaseUrl);
  const response = await fetch(url, {
    headers: { accept: "application/yaml,text/yaml,*/*" },
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    throw new SpecFetchError(`spec fetch failed: HTTP ${response.status}`, response.status);
  }

  const text = await response.text();
  const raw = load(text);

  const parsed = specSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SpecFetchError(`spec shape mismatch: ${parsed.error.message}`);
  }

  return parsed.data;
}
