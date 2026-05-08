"use client";

import { Progress } from "@/components/ui/progress";
import type { ChunkProgress } from "@/lib/bulk/chunk";

/**
 * Shared progress strip for the three bulk tabs. Renders only
 * while a run is in flight; collapses to nothing once results
 * have all arrived (the results table is the post-run state).
 *
 * The percentage drives the bar; the operator-facing text shows
 * cumulative items so a 5K-item put reads "3,200 / 5,000" rather
 * than "Chunk 4 of 5" — the latter is meaningless without
 * mental-math.
 */
export function BulkProgress({ progress, running }: { progress: ChunkProgress | null; running: boolean }) {
  if (!running || progress === null || progress.itemsTotal === 0) return null;
  const pct = Math.min(100, Math.round((progress.itemsProcessed / progress.itemsTotal) * 100));
  return (
    <div
      className="border-border/50 bg-card/50 space-y-2 rounded-md border p-3"
      role="status"
      aria-live="polite"
      aria-label={`Bulk operation in progress: ${progress.itemsProcessed} of ${progress.itemsTotal} items`}
    >
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>
          Chunk <span className="text-foreground font-mono">{progress.chunkIndex}</span> of{" "}
          <span className="text-foreground font-mono">{progress.totalChunks}</span>
        </span>
        <span>
          <span className="text-foreground font-mono">{progress.itemsProcessed.toLocaleString()}</span> /{" "}
          <span className="font-mono">{progress.itemsTotal.toLocaleString()}</span> items ({pct}%)
        </span>
      </div>
      <Progress value={pct} aria-hidden />
    </div>
  );
}
