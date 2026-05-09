/**
 * Streaming chunked-request helper for the bulk surface.
 *
 * Splits an input array into fixed-size chunks, calls the
 * supplied fetcher serially per chunk, and pushes each chunk's
 * results to the caller via `onChunkResults` *as they arrive*.
 *
 * Why serial and not parallel: the cache's batch endpoints
 * touch many keys per request and are I/O-bound on the cluster
 * side. Firing 5 chunks in parallel doesn't help wall-clock by
 * much (the cache serializes work at some point) but it does
 * make the operator's progress UX harder to reason about (rates
 * jitter, partial-failure attribution gets ambiguous). Serial
 * is the right default; if a future "go fast" mode wants
 * parallel, it's a small wrapper away.
 *
 * Why streaming rather than collect-and-return: a 5K-item put
 * fans out as 5 chunks of 1K. Streaming lets the `<DataTable>`
 * paint the first 1K rows after ~200ms instead of staring at a
 * spinner for ~1s.
 */

export const DEFAULT_CHUNK_SIZE = 1000;

export interface ChunkProgress {
  /** 1-based index of the chunk just completed. */
  chunkIndex: number;
  /** Total number of chunks for this run. */
  totalChunks: number;
  /** Cumulative count of items processed so far (across all completed chunks). */
  itemsProcessed: number;
  /** Total input items. */
  itemsTotal: number;
}

export interface RunChunkedOptions<TItem, TResult> {
  /**
   * The full input list. Empty list resolves immediately with
   * an empty result and a single 0/0 progress tick — caller
   * decides whether to render the "no items" empty state.
   */
  items: readonly TItem[];
  /** Items per request. Defaults to 1000 (matches the original B3 plan). */
  chunkSize?: number;
  /**
   * Issues one batch request for this slice. The implementation
   * is endpoint-specific (batch/get vs batch/put vs batch/delete)
   * and returns whatever per-item result shape that endpoint
   * produces.
   */
  fetcher: (chunk: TItem[]) => Promise<TResult[]>;
  /** Called after each successful chunk with the new result rows. */
  onChunkResults?: (rows: TResult[]) => void;
  /** Called after each chunk (success OR throw) with progress meta. */
  onProgress?: (progress: ChunkProgress) => void;
  /**
   * AbortSignal for cancellation. Aborting after a chunk completes
   * stops the loop *before* the next request fires; we don't
   * forward the signal into `fetcher` itself — callers that need
   * to cancel an in-flight request should plumb their own signal
   * through their fetch closure.
   */
  signal?: AbortSignal;
}

export interface ChunkedRunResult<TResult> {
  results: TResult[];
  /**
   * `true` when the loop completed normally; `false` when
   * `signal.aborted` halted it early. Partial `results` are
   * always populated for completed chunks regardless.
   */
  completed: boolean;
}

/**
 * Splits `items` into chunks of `chunkSize`, calls `fetcher`
 * serially per chunk, accumulates and streams results. Errors
 * from `fetcher` propagate — the caller catches them and
 * decides whether to retry or surface to the operator.
 */
export async function runChunked<TItem, TResult>(
  opts: RunChunkedOptions<TItem, TResult>,
): Promise<ChunkedRunResult<TResult>> {
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
  if (chunkSize < 1 || !Number.isInteger(chunkSize)) {
    throw new Error(
      `runChunked: chunkSize must be a positive integer, got ${chunkSize}`,
    );
  }

  const totalChunks = Math.ceil(opts.items.length / chunkSize);
  const results: TResult[] = [];

  if (opts.items.length === 0) {
    opts.onProgress?.({
      chunkIndex: 0,
      totalChunks: 0,
      itemsProcessed: 0,
      itemsTotal: 0,
    });
    return { results, completed: true };
  }

  for (let i = 0; i < totalChunks; i++) {
    if (opts.signal?.aborted) {
      return { results, completed: false };
    }
    const start = i * chunkSize;
    const slice = opts.items.slice(start, start + chunkSize) as TItem[];
    const rows = await opts.fetcher(slice);
    results.push(...rows);
    opts.onChunkResults?.(rows);
    opts.onProgress?.({
      chunkIndex: i + 1,
      totalChunks,
      itemsProcessed: Math.min((i + 1) * chunkSize, opts.items.length),
      itemsTotal: opts.items.length,
    });
  }

  return { results, completed: true };
}
