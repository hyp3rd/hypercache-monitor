import { describe, expect, it, vi } from "vitest";
import { runChunked } from "./chunk";

/**
 * Pins the streaming + cancellation contract that the bulk
 * page UI relies on. The fetcher is mocked synchronously
 * (Promise.resolve) — we're testing the loop, not network I/O.
 */

describe("runChunked", () => {
  it("returns immediately for empty input with a 0/0 progress tick", async () => {
    const onProgress = vi.fn();
    const fetcher = vi.fn();
    const out = await runChunked({ items: [], fetcher, onProgress });
    expect(out.results).toEqual([]);
    expect(out.completed).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledWith({
      chunkIndex: 0,
      totalChunks: 0,
      itemsProcessed: 0,
      itemsTotal: 0,
    });
  });

  it("splits input into chunks of the configured size", async () => {
    const fetcher = vi.fn(async (chunk: number[]) => chunk.map((n) => `r${n}`));
    const items = [1, 2, 3, 4, 5, 6, 7];
    const out = await runChunked({ items, chunkSize: 3, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]?.[0]).toEqual([1, 2, 3]);
    expect(fetcher.mock.calls[1]?.[0]).toEqual([4, 5, 6]);
    expect(fetcher.mock.calls[2]?.[0]).toEqual([7]);
    expect(out.results).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7"]);
    expect(out.completed).toBe(true);
  });

  it("streams results to onChunkResults as each chunk completes", async () => {
    const onChunkResults = vi.fn();
    const fetcher = async (chunk: number[]) => chunk.map((n) => `r${n}`);
    await runChunked({
      items: [1, 2, 3, 4, 5],
      chunkSize: 2,
      fetcher,
      onChunkResults,
    });
    expect(onChunkResults).toHaveBeenCalledTimes(3);
    expect(onChunkResults.mock.calls[0]?.[0]).toEqual(["r1", "r2"]);
    expect(onChunkResults.mock.calls[1]?.[0]).toEqual(["r3", "r4"]);
    expect(onChunkResults.mock.calls[2]?.[0]).toEqual(["r5"]);
  });

  it("emits progress with cumulative itemsProcessed", async () => {
    const onProgress = vi.fn();
    await runChunked({
      items: [1, 2, 3, 4, 5],
      chunkSize: 2,
      fetcher: async (chunk: number[]) => chunk,
      onProgress,
    });
    const progressCalls = onProgress.mock.calls.map((c) => c[0]);
    expect(progressCalls).toEqual([
      { chunkIndex: 1, totalChunks: 3, itemsProcessed: 2, itemsTotal: 5 },
      { chunkIndex: 2, totalChunks: 3, itemsProcessed: 4, itemsTotal: 5 },
      { chunkIndex: 3, totalChunks: 3, itemsProcessed: 5, itemsTotal: 5 },
    ]);
  });

  it("propagates fetcher errors and stops the loop", async () => {
    const onChunkResults = vi.fn();
    const fetcher = vi.fn(async (chunk: number[]) => {
      if (chunk[0] === 3) throw new Error("upstream timeout");
      return chunk.map((n) => `r${n}`);
    });
    await expect(
      runChunked({
        items: [1, 2, 3, 4, 5],
        chunkSize: 1,
        fetcher,
        onChunkResults,
      }),
    ).rejects.toThrow(/upstream timeout/);
    // Two successful chunks streamed before the failure
    expect(onChunkResults).toHaveBeenCalledTimes(2);
  });

  it("halts before the next chunk when the signal is aborted between chunks", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async (chunk: number[]) => {
      if (chunk[0] === 3) controller.abort();
      return chunk.map((n) => `r${n}`);
    });
    const out = await runChunked({
      items: [1, 2, 3, 4, 5, 6],
      chunkSize: 1,
      fetcher,
      signal: controller.signal,
    });
    // chunk 3 ran and triggered abort; chunks 4,5,6 should NOT run
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(out.results).toEqual(["r1", "r2", "r3"]);
    expect(out.completed).toBe(false);
  });

  it("rejects non-integer / non-positive chunk sizes loud", async () => {
    await expect(
      runChunked({ items: [1], chunkSize: 0, fetcher: async () => [] }),
    ).rejects.toThrow(/chunkSize must be a positive integer/);
    await expect(
      runChunked({ items: [1], chunkSize: 2.5, fetcher: async () => [] }),
    ).rejects.toThrow(/chunkSize must be a positive integer/);
  });

  it("uses the documented default chunk size of 1000", async () => {
    const items = Array.from({ length: 2500 }, (_, i) => i);
    const fetcher = vi.fn(async (chunk: number[]) => chunk);
    await runChunked({ items, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]?.[0].length).toBe(1000);
    expect(fetcher.mock.calls[1]?.[0].length).toBe(1000);
    expect(fetcher.mock.calls[2]?.[0].length).toBe(500);
  });
});
