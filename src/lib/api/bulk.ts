import { z } from "zod";
import { apiPath } from "./keys";

/**
 * Hand-written zod-typed wrapper for the HyperCache **client
 * API** batch endpoints (port 8080):
 *
 *   POST /v1/cache/batch/get     → { keys: string[] } → results[]
 *   POST /v1/cache/batch/put     → { items: BatchPutItem[] } → results[]
 *   POST /v1/cache/batch/delete  → { keys: string[] } → results[]
 *
 * Per-item granularity: each result carries `error` / `code`
 * when an individual key fails; the batch as a whole is 200 OK
 * unless the request didn't parse. The UI MUST render
 * mixed-success batches — assuming "all-or-nothing" hides
 * failures.
 *
 * Wire shapes mirror `cmd/hypercache-server/main.go` (the
 * batchGetResult / batchPutItem / batchPutResult /
 * batchDeleteResult Go structs). The schemas accept `passthrough`
 * on the result types so a future field on the Go side surfaces
 * in the UI without a parse failure.
 */

// ---- Request types ---------------------------------------------------

export interface BatchPutItem {
  key: string;
  value: string;
  /** "base64" for binary payloads; absent (or any other value) treats `value` as UTF-8. */
  value_encoding?: "base64";
  /** Time-to-live in milliseconds; 0/absent = no TTL. */
  ttl_ms?: number;
}

// ---- Response schemas -----------------------------------------------

export const batchGetResultSchema = z
  .object({
    key: z.string(),
    found: z.boolean(),
    value: z.string().optional(),
    value_encoding: z.string().optional(),
    ttl_ms: z.number().int().nonnegative().optional(),
    expires_at: z.string().optional(),
    version: z.number().int().nonnegative().optional(),
    origin: z.string().optional(),
    last_updated: z.string().optional(),
    owners: z.array(z.string()).optional(),
  })
  .passthrough();
export type BatchGetResult = z.infer<typeof batchGetResultSchema>;

export const batchGetResponseSchema = z.object({
  results: z.array(batchGetResultSchema),
  node: z.string(),
});
export type BatchGetResponse = z.infer<typeof batchGetResponseSchema>;

export const batchPutResultSchema = z
  .object({
    key: z.string(),
    stored: z.boolean(),
    bytes: z.number().int().nonnegative().optional(),
    owners: z.array(z.string()).optional(),
    error: z.string().optional(),
    code: z.string().optional(),
  })
  .passthrough();
export type BatchPutResult = z.infer<typeof batchPutResultSchema>;

export const batchPutResponseSchema = z.object({
  results: z.array(batchPutResultSchema),
  node: z.string(),
});
export type BatchPutResponse = z.infer<typeof batchPutResponseSchema>;

export const batchDeleteResultSchema = z
  .object({
    key: z.string(),
    deleted: z.boolean(),
    owners: z.array(z.string()).optional(),
    error: z.string().optional(),
    code: z.string().optional(),
  })
  .passthrough();
export type BatchDeleteResult = z.infer<typeof batchDeleteResultSchema>;

export const batchDeleteResponseSchema = z.object({
  results: z.array(batchDeleteResultSchema),
  node: z.string(),
});
export type BatchDeleteResponse = z.infer<typeof batchDeleteResponseSchema>;

// ---- Error envelope (proxy-side error responses) ---------------------

const errorEnvelope = z.object({
  error: z.string(),
  code: z.string(),
});

export class BulkApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "BulkApiError";
  }
}

// ---- Fetchers --------------------------------------------------------

/**
 * Sends a batch-get request for the supplied keys. Returns the
 * full response (results + node). Caller is responsible for
 * chunking large key lists — see `src/lib/bulk/chunk.ts`.
 */
export async function batchGet(clusterId: string, keys: string[]): Promise<BatchGetResponse> {
  return postJson(clusterId, ["v1", "cache", "batch", "get"], { keys }, batchGetResponseSchema);
}

export async function batchPut(clusterId: string, items: BatchPutItem[]): Promise<BatchPutResponse> {
  return postJson(clusterId, ["v1", "cache", "batch", "put"], { items }, batchPutResponseSchema);
}

export async function batchDelete(clusterId: string, keys: string[]): Promise<BatchDeleteResponse> {
  return postJson(clusterId, ["v1", "cache", "batch", "delete"], { keys }, batchDeleteResponseSchema);
}

async function postJson<T>(
  clusterId: string,
  segments: string[],
  body: unknown,
  schema: z.ZodSchema<T>,
): Promise<T> {
  const response = await fetch(apiPath(clusterId, ...segments), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    const env = errorEnvelope.safeParse(json);
    const message = env.success ? env.data.error : `HTTP ${response.status}`;
    const code = env.success ? env.data.code : undefined;
    throw new BulkApiError(message, response.status, code);
  }

  const json = await response.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`bulk response shape mismatch at ${segments.join("/")}: ${parsed.error.message}`);
  }
  return parsed.data;
}
