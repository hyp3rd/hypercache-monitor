import { z } from "zod";

/**
 * Hand-written zod-typed wrapper for the HyperCache **client
 * API** (port 8080) single-key endpoints. Mirrors the shapes
 * documented in `cmd/hypercache-server/openapi.yaml` from the
 * cache repo:
 *
 *   GET  /v1/cache/{key}     (Accept: application/json) → ItemEnvelope
 *   HEAD /v1/cache/{key}                                → metadata in headers
 *   PUT  /v1/cache/{key}     (?ttl=Go-duration)         → PutResponse
 *   DEL  /v1/cache/{key}                                → DeleteResponse
 *   GET  /v1/owners/{key}                               → OwnersResponse
 *
 * The generated Hey API client (`src/lib/api/generated/`)
 * also covers these, but the wrapper here keeps the call-site
 * shape consistent with `mgmt.ts` (zod parse on read; typed
 * errors with a `code` discriminator). Bulk operations
 * (Phase B3) will use the generated client where typed batch
 * shapes pay off.
 */

// ---- Schemas ---------------------------------------------------------

export const itemEnvelopeSchema = z.object({
  key: z.string(),
  value: z.string(),
  value_encoding: z.literal("base64"),
  ttl_ms: z.number().int().nonnegative().optional(),
  expires_at: z.string().optional(),
  version: z.number().int(),
  origin: z.string().optional(),
  last_updated: z.string().optional(),
  node: z.string(),
  owners: z.array(z.string()),
});
export type ItemEnvelope = z.infer<typeof itemEnvelopeSchema>;

export const putResponseSchema = z.object({
  key: z.string(),
  stored: z.boolean(),
  ttl_ms: z.number().int().nonnegative().optional(),
  bytes: z.number().int().nonnegative(),
  node: z.string(),
  owners: z.array(z.string()),
});
export type PutResponse = z.infer<typeof putResponseSchema>;

export const deleteResponseSchema = z.object({
  key: z.string(),
  deleted: z.boolean(),
  node: z.string(),
  owners: z.array(z.string()),
});
export type DeleteResponse = z.infer<typeof deleteResponseSchema>;

export const ownersResponseSchema = z.object({
  key: z.string(),
  owners: z.array(z.string()),
  node: z.string(),
});
export type OwnersResponse = z.infer<typeof ownersResponseSchema>;

const errorEnvelopeSchema = z.object({
  error: z.string(),
  code: z.string(),
});

// ---- Errors ----------------------------------------------------------

/**
 * Rich error type so call sites can branch on `code`
 * (`NOT_FOUND`, `UNAUTHORIZED`, `DRAINING`, …) without
 * regex-matching messages. Mirrors the cache's
 * `ErrorResponse` shape from the OpenAPI spec.
 */
export class CacheApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CacheApiError";
    this.status = status;
    this.code = code;
  }
}

async function readError(response: Response): Promise<CacheApiError> {
  const body = await response.json().catch(() => ({}));
  const env = errorEnvelopeSchema.safeParse(body);
  if (env.success) {
    return new CacheApiError(response.status, env.data.code, env.data.error);
  }
  return new CacheApiError(response.status, "UNKNOWN", `HTTP ${response.status}`);
}

// ---- Helpers ---------------------------------------------------------

function apiPath(clusterId: string, ...segments: string[]): string {
  const encodedCluster = encodeURIComponent(clusterId);
  const tail = segments.map((s) => encodeURIComponent(s)).join("/");
  return `/api/clusters/${encodedCluster}/api/${tail}`;
}

const baseFetchInit: RequestInit = {
  credentials: "same-origin",
  cache: "no-store",
};

// ---- API ------------------------------------------------------------

/**
 * Fetch one key with the JSON envelope. Returns `null` on
 * 404 (idiomatic for "key not found"); throws CacheApiError
 * for every other failure so React Query's error boundary
 * can branch.
 */
export async function fetchKey(clusterId: string, key: string): Promise<ItemEnvelope | null> {
  const response = await fetch(apiPath(clusterId, "v1", "cache", key), {
    ...baseFetchInit,
    headers: { accept: "application/json" },
  });

  if (response.status === 404) return null;
  if (!response.ok) throw await readError(response);

  return itemEnvelopeSchema.parse(await response.json());
}

/**
 * HEAD /v1/cache/{key} — checks existence + reads metadata
 * via X-Cache-* response headers. Returns the parsed shape
 * on 200, null on 404. Cheap "does this key exist?" query.
 */
export async function headKey(
  clusterId: string,
  key: string,
): Promise<{ version: number; owners: string[]; ttlMs?: number } | null> {
  const response = await fetch(apiPath(clusterId, "v1", "cache", key), {
    ...baseFetchInit,
    method: "HEAD",
  });

  if (response.status === 404) return null;
  if (!response.ok) throw await readError(response);

  const owners = response.headers.get("x-cache-owners")?.split(",").filter(Boolean) ?? [];
  const versionHdr = response.headers.get("x-cache-version");
  const ttlHdr = response.headers.get("x-cache-ttl-ms");

  return {
    version: versionHdr ? Number(versionHdr) : 0,
    owners,
    ...(ttlHdr ? { ttlMs: Number(ttlHdr) } : {}),
  };
}

/**
 * Resolve ring owners for any key — even keys that have never
 * been written. Pure visibility endpoint, no cache state read.
 */
export async function fetchOwners(clusterId: string, key: string): Promise<OwnersResponse> {
  const response = await fetch(apiPath(clusterId, "v1", "owners", key), {
    ...baseFetchInit,
    headers: { accept: "application/json" },
  });

  if (!response.ok) throw await readError(response);

  return ownersResponseSchema.parse(await response.json());
}

/**
 * Store a value. The body is sent as raw bytes (the cache
 * stores it as `[]byte`), so callers pass either a string
 * (UTF-8 text) or an ArrayBuffer / Blob (binary). TTL is
 * optional; if omitted, the value never expires.
 */
export interface PutKeyArgs {
  clusterId: string;
  key: string;
  body: string | Blob | ArrayBuffer;
  ttl?: string; // Go duration: "30s", "5m", "2h"
  contentType?: string;
}

export async function putKey({ clusterId, key, body, ttl, contentType }: PutKeyArgs): Promise<PutResponse> {
  const url = new URL(apiPath(clusterId, "v1", "cache", key), window.location.origin);
  if (ttl !== undefined && ttl !== "") {
    url.searchParams.set("ttl", ttl);
  }

  const response = await fetch(url.toString(), {
    ...baseFetchInit,
    method: "PUT",
    headers: { "content-type": contentType ?? "application/octet-stream" },
    body,
  });

  if (!response.ok) throw await readError(response);

  return putResponseSchema.parse(await response.json());
}

/**
 * Delete a key. Idempotent — deleting a missing key returns
 * 200 with `deleted: true`. The owners list reflects where
 * the key would live, useful for follow-up verification.
 */
export async function deleteKey(clusterId: string, key: string): Promise<DeleteResponse> {
  const response = await fetch(apiPath(clusterId, "v1", "cache", key), {
    ...baseFetchInit,
    method: "DELETE",
  });

  if (!response.ok) throw await readError(response);

  return deleteResponseSchema.parse(await response.json());
}
