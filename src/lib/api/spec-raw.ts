import "server-only";

import { load } from "js-yaml";
import { getCluster } from "@/lib/clusters/registry";
import { SpecFetchError } from "./spec";

/**
 * Server-side raw-spec fetcher for Phase B5's `/spec` viewer.
 *
 * Why this exists alongside `spec.ts`:
 *   - `spec.ts` returns a typed projection (zod-validated) that
 *     intentionally drops `paths`, `components.schemas`, examples,
 *     etc. — `/auth-info` only needs `securitySchemes`.
 *   - The Scalar renderer wants the WHOLE document. Adding `paths`
 *     and `schemas` to `spec.ts`'s zod schema would either make
 *     that schema ~500 lines (mirroring all of OpenAPI 3.1), or
 *     cause it to drop fields silently when validating — both
 *     worse than the duplication.
 *
 * So this file owns the raw-document path. No zod validation
 * beyond an `openapi` version string check (Scalar handles
 * deeper validation itself); we trust the cache to emit a
 * spec-shaped document.
 *
 * Security note on the dompurify / monaco-editor chain that
 * Scalar pulls in: the OpenAPI spec content rendered here is
 * authored by the cache operator (not arbitrary internet
 * users). An attacker who controls the cache's spec already has
 * admin in the cluster, so the moderate DOMPurify XSS findings
 * in npm audit don't translate into a practical attack vector
 * for this deployment shape. Tracked: dependency upgrades land
 * via Scalar's own release cadence, not the monitor's.
 */

/**
 * RawSpec is intentionally `Record<string, unknown>` — Scalar
 * accepts the spec as-is, and adding stricter types here would
 * just push casts into the consumer. The few places we DO read
 * fields (the path filter), we narrow at the call site.
 */
export type RawSpec = Record<string, unknown>;

/**
 * fetchSpecRaw returns the cache cluster's full OpenAPI YAML
 * parsed into a plain JS object. Uses Next's data-cache for 60s
 * — same revalidation policy as `spec.ts`'s typed fetcher.
 */
export async function fetchSpecRaw(clusterId: string): Promise<RawSpec> {
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
  const parsed = load(text);

  if (parsed === null || typeof parsed !== "object") {
    throw new SpecFetchError("spec parse returned non-object");
  }

  // Sanity-check: every OpenAPI document carries an `openapi`
  // version string. If absent we got something other than a
  // spec (HTML error page that returned 200, etc.).
  if (typeof (parsed as RawSpec)["openapi"] !== "string") {
    throw new SpecFetchError("spec missing 'openapi' version field");
  }

  return parsed as RawSpec;
}

/**
 * HTTP methods Scalar's "Try It Out" can invoke from this page.
 * Read methods only — write methods (POST/PUT/PATCH/DELETE) are
 * routed through the Single-Key Inspector / Bulk pages, both of
 * which already gate destructive ops behind explicit confirm.
 *
 * `OPTIONS`/`HEAD` are read-shaped and side-effect-free, so they
 * round out the safe set.
 */
const SAFE_METHODS = new Set(["get", "head", "options", "trace"]);

/**
 * filterToSafeMethods returns a deep-cloned copy of `spec` with
 * every operation under `paths.*` whose HTTP method is NOT in
 * `SAFE_METHODS` removed. Path-level fields (`parameters`,
 * `summary`, `description`) are preserved; only the operation
 * objects are dropped.
 *
 * If a path ends up with zero operations after filtering, the
 * path itself is removed — leaving a `paths['/x']: {}` entry
 * would render as a header with no body in Scalar, which looks
 * like a render bug.
 *
 * Tested in spec-raw.test.ts.
 */
export function filterToSafeMethods(spec: RawSpec): RawSpec {
  // Structured-clone for a defensive copy — the input must not
  // be mutated (Next caches the response from `fetchSpecRaw`).
  const clone = structuredClone(spec) as RawSpec;
  const paths = clone["paths"];
  if (paths === null || typeof paths !== "object") {
    return clone;
  }

  const pathsRecord = paths as Record<string, Record<string, unknown>>;
  for (const [pathName, pathItem] of Object.entries(pathsRecord)) {
    if (pathItem === null || typeof pathItem !== "object") continue;
    let operationCount = 0;
    for (const key of Object.keys(pathItem)) {
      // Operation keys are HTTP method names; non-method keys
      // (parameters, summary, description, $ref, servers) are
      // path-level metadata and stay regardless.
      if (!isHttpMethodKey(key)) continue;
      if (SAFE_METHODS.has(key.toLowerCase())) {
        operationCount++;
        continue;
      }
      delete pathItem[key];
    }
    if (operationCount === 0) {
      delete pathsRecord[pathName];
    }
  }

  return clone;
}

/**
 * Scalar / OpenAPI distinguish HTTP methods from path-level
 * metadata by name. We list methods explicitly (rather than
 * "anything not in METADATA_KEYS") to avoid silently treating
 * an unknown future field as a method and dropping it.
 */
const HTTP_METHOD_KEYS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);

function isHttpMethodKey(key: string): boolean {
  return HTTP_METHOD_KEYS.has(key.toLowerCase());
}
