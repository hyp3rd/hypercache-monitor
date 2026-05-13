import { z } from "zod";
import { apiPath, CacheApiError } from "./keys";

/**
 * Cluster-wide key browser (`GET /v1/cache/keys`).
 *
 * Sits next to `keys.ts`'s single-key operations because the
 * wire surface is the same upstream service, but kept in its
 * own file because the *semantics* are different: this is an
 * operator-debug enumeration with paging + best-effort partial
 * results, not a key-by-key access path. Splitting the file
 * mirrors how `bulk.ts` is separate from `keys.ts`.
 *
 * The upstream wire shape is documented in
 * `cmd/hypercache-server/openapi.yaml` (ListKeysResponse) and
 * pinned in `cmd/hypercache-server/handlers_test.go` —
 * `TestHandleListKeys_PrefixAndPaging` is the contract we
 * mirror here.
 */

// ---- Schemas ---------------------------------------------------------

/**
 * Wire shape exactly as the upstream emits it (snake_case).
 * Internal call sites consume the camelCase form via the
 * `transform` step below — same pattern as `metrics.ts`.
 */
const listKeysWireSchema = z.object({
  keys: z.array(z.string()),
  next_cursor: z.string(),
  total_matched: z.number().int().nonnegative(),
  truncated: z.boolean(),
  node: z.string(),
  // partial_nodes is omitted from the wire on the happy path (the
  // backend uses omitempty); `.default([])` normalizes that to an
  // empty array so call sites never branch on undefined.
  partial_nodes: z.array(z.string()).default([]),
});

export const listKeysResponseSchema = listKeysWireSchema.transform((raw) => ({
  keys: raw.keys,
  nextCursor: raw.next_cursor,
  totalMatched: raw.total_matched,
  truncated: raw.truncated,
  node: raw.node,
  partialNodes: raw.partial_nodes,
}));
export type ListKeysResponse = z.infer<typeof listKeysResponseSchema>;

// ---- API ------------------------------------------------------------

export interface FetchKeyListParams {
  /**
   * Filter pattern. Prefix when no glob metacharacter (`*`, `?`,
   * `[`) is present; glob via `path.Match` semantics otherwise.
   * Empty string means "no filter — return everything (up to
   * `max`)".
   */
  q?: string;
  /**
   * Offset into the deduplicated, sorted result set returned by a
   * previous page's `nextCursor`. Omit for the first page.
   */
  cursor?: string;
  /**
   * Page size. Defaults to the upstream's 100 when omitted; the
   * upstream caps at 500.
   */
  limit?: number;
  /**
   * Total deduplicated result-set cap. Defaults to the upstream's
   * 10000 when omitted; the upstream caps at 50000. Reaching it
   * surfaces `truncated: true`.
   */
  max?: number;
}

const baseFetchInit: RequestInit = {
  credentials: "same-origin",
  cache: "no-store",
};

const errorEnvelopeSchema = z.object({ error: z.string(), code: z.string() });

async function readError(response: Response): Promise<CacheApiError> {
  const body = await response.json().catch(() => ({}));
  const env = errorEnvelopeSchema.safeParse(body);
  if (env.success) {
    return new CacheApiError(response.status, env.data.code, env.data.error);
  }
  return new CacheApiError(
    response.status,
    "UNKNOWN",
    `HTTP ${response.status}`,
  );
}

/**
 * Fetch one page of the cluster-wide key list. Routes through
 * the cluster-aware proxy at
 * `/api/clusters/{clusterId}/api/v1/cache/keys`. All four query
 * params are optional and forwarded as-is.
 */
export async function fetchKeyList(
  clusterId: string,
  params: FetchKeyListParams = {},
): Promise<ListKeysResponse> {
  const search = new URLSearchParams();
  if (params.q !== undefined && params.q !== "") search.set("q", params.q);
  if (params.cursor !== undefined && params.cursor !== "") {
    search.set("cursor", params.cursor);
  }
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.max !== undefined) search.set("max", String(params.max));

  const base = apiPath(clusterId, "v1", "cache", "keys");
  const url = search.toString() ? `${base}?${search.toString()}` : base;

  const response = await fetch(url, {
    ...baseFetchInit,
    headers: { accept: "application/json" },
  });

  if (!response.ok) throw await readError(response);

  return listKeysResponseSchema.parse(await response.json());
}
