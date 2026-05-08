"use client";

import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { batchPut, type BatchPutItem, type BatchPutResult } from "@/lib/api/bulk";
import { runChunked, type ChunkProgress } from "@/lib/bulk/chunk";
import { useState } from "react";
import { Play, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { BulkProgress } from "./bulk-progress";
import { CsvInput } from "./csv-input";

/**
 * Bulk put — operator uploads CSV (key,value,ttl_ms?,value_encoding?),
 * we POST chunked /batch/put and stream per-item results.
 *
 * The cache returns 200 with mixed-success per-item rows; the
 * UI must render `stored: false` rows with their `error` /
 * `code` so a partial failure isn't hidden as a green check.
 */
export function PutTab({ clusterId }: { clusterId: string }) {
  const [items, setItems] = useState<BatchPutItem[]>([]);
  const [results, setResults] = useState<BatchPutResult[]>([]);
  const [progress, setProgress] = useState<ChunkProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (items.length === 0) return;
    setRunning(true);
    setError(null);
    setResults([]);
    setProgress(null);

    try {
      const out = await runChunked({
        items,
        fetcher: async (chunk) => {
          const resp = await batchPut(clusterId, chunk);
          return resp.results;
        },
        onChunkResults: (rows) => setResults((prev) => prev.concat(rows)),
        onProgress: setProgress,
      });
      const stored = out.results.filter((r) => r.stored).length;
      const failed = out.results.length - stored;
      toast[failed === 0 ? "success" : "warning"](
        `Stored ${stored.toLocaleString()} of ${out.results.length.toLocaleString()}`,
        {
          description: failed === 0 ? "All items written." : `${failed} item(s) failed — see results table.`,
        },
      );
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      toast.error("Bulk put failed", { description: message });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="border-border/50 bg-card/40 space-y-4 rounded-lg border p-4">
        <CsvInput onItemsChange={setItems} />
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">
            Chunked at 1,000 items per request. Per-item failures don&apos;t halt the batch.
          </p>
          <Button onClick={run} disabled={running || items.length === 0}>
            <Play aria-hidden className="mr-1.5 h-3.5 w-3.5" />
            {running ? "Running…" : `Store ${items.length.toLocaleString()}`}
          </Button>
        </div>
      </div>

      <BulkProgress progress={progress} running={running} />

      {error !== null && !running && (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive ring-destructive/20 inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm ring-1"
        >
          <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span className="font-mono text-xs">{error}</span>
        </p>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-mono">{results.length.toLocaleString()}</span> results ·{" "}
            <span className="text-foreground font-mono">
              {results.filter((r) => r.stored).length.toLocaleString()}
            </span>{" "}
            stored ·{" "}
            <span className="text-foreground font-mono">
              {results.filter((r) => !r.stored).length.toLocaleString()}
            </span>{" "}
            failed
          </p>
          <DataTable columns={putColumns} data={results} filterPlaceholder="Filter by key…" />
        </div>
      )}
    </div>
  );
}

const putColumns: ColumnDef<BatchPutResult>[] = [
  {
    accessorKey: "key",
    header: "Key",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.key}</span>,
  },
  {
    accessorKey: "stored",
    header: "Status",
    cell: ({ row }) => (
      <span
        className={
          row.original.stored
            ? "inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-500 ring-1 ring-emerald-500/20"
            : "inline-flex items-center rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-500 ring-1 ring-rose-500/20"
        }
      >
        {row.original.stored ? "stored" : "failed"}
      </span>
    ),
  },
  {
    accessorKey: "bytes",
    header: "Bytes",
    cell: ({ row }) =>
      row.original.bytes !== undefined ? (
        <span className="text-muted-foreground font-mono text-xs">{row.original.bytes.toLocaleString()}</span>
      ) : (
        <span className="text-muted-foreground/50">—</span>
      ),
  },
  {
    accessorKey: "error",
    header: "Error",
    enableSorting: false,
    cell: ({ row }) => {
      if (row.original.stored) return <span className="text-muted-foreground/50">—</span>;
      return (
        <span className="text-destructive font-mono text-xs">
          {row.original.code ? `[${row.original.code}] ` : ""}
          {row.original.error ?? "(no message)"}
        </span>
      );
    },
  },
];
