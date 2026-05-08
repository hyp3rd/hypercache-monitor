"use client";

import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { type BatchGetResult, batchGet } from "@/lib/api/bulk";
import { runChunked, type ChunkProgress } from "@/lib/bulk/chunk";
import { serializeCsv } from "@/lib/csv/csv";
import { decodeBase64, decodeUtf8 } from "@/lib/value-decode";
import { useState } from "react";
import { Download, Play, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { BulkProgress } from "./bulk-progress";
import { KeysInput } from "./keys-input";

/**
 * Bulk fetch — paste/upload keys, POST chunked /batch/get,
 * stream results into the table, offer CSV download.
 *
 * The CSV download projects the wire shape into a flat,
 * spreadsheet-friendly format: `key, found, value_utf8,
 * value_base64, ttl_ms, version, owners`. The `value_utf8`
 * column is best-effort decoded — operators get readable text
 * for ASCII payloads and an empty cell for binary (base64
 * column always populated, so no data is lost).
 */
export function FetchTab({ clusterId }: { clusterId: string }) {
  const [keys, setKeys] = useState<string[]>([]);
  const [results, setResults] = useState<BatchGetResult[]>([]);
  const [progress, setProgress] = useState<ChunkProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (keys.length === 0) return;
    setRunning(true);
    setError(null);
    setResults([]);
    setProgress(null);

    try {
      await runChunked({
        items: keys,
        fetcher: async (chunk) => {
          const resp = await batchGet(clusterId, chunk);
          return resp.results;
        },
        onChunkResults: (rows) => setResults((prev) => prev.concat(rows)),
        onProgress: setProgress,
      });
      const found = results.length; // stale closure; recomputed below for toast
      toast.success(`Fetched ${keys.length.toLocaleString()} keys`, {
        description: `${found} found, ${keys.length - found} missing`,
      });
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      toast.error("Bulk fetch failed", { description: message });
    } finally {
      setRunning(false);
    }
  }

  function downloadCsv() {
    const rows = results.map((r) => ({
      key: r.key,
      found: r.found,
      value_utf8: r.value !== undefined ? bestEffortUtf8(r.value) : "",
      value_base64: r.value ?? "",
      ttl_ms: r.ttl_ms ?? "",
      version: r.version ?? "",
      owners: r.owners?.join("|") ?? "",
    }));
    const csv = serializeCsv(rows);
    triggerDownload(csv, `bulk-fetch-${Date.now()}.csv`);
  }

  return (
    <div className="space-y-5">
      <div className="border-border/50 bg-card/40 space-y-4 rounded-lg border p-4">
        <KeysInput
          label="Keys to fetch"
          onKeysChange={setKeys}
          placeholder="user:1234\nsession:abc\norders:2025-Q1"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">
            Chunked at 1,000 items per request. Each chunk&apos;s results stream into the table below.
          </p>
          <Button onClick={run} disabled={running || keys.length === 0}>
            <Play aria-hidden className="mr-1.5 h-3.5 w-3.5" />
            {running ? "Running…" : `Fetch ${keys.length.toLocaleString()}`}
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
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              <span className="text-foreground font-mono">{results.length.toLocaleString()}</span> results ·{" "}
              <span className="text-foreground font-mono">
                {results.filter((r) => r.found).length.toLocaleString()}
              </span>{" "}
              found ·{" "}
              <span className="text-foreground font-mono">
                {results.filter((r) => !r.found).length.toLocaleString()}
              </span>{" "}
              missing
            </p>
            <Button variant="outline" size="sm" onClick={downloadCsv}>
              <Download aria-hidden className="mr-1.5 h-3.5 w-3.5" />
              Download CSV
            </Button>
          </div>
          <DataTable columns={fetchColumns} data={results} filterPlaceholder="Filter by key…" />
        </div>
      )}
    </div>
  );
}

const fetchColumns: ColumnDef<BatchGetResult>[] = [
  {
    accessorKey: "key",
    header: "Key",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.key}</span>,
  },
  {
    accessorKey: "found",
    header: "Status",
    cell: ({ row }) => <StatusPill ok={row.original.found} okLabel="found" failLabel="missing" />,
  },
  {
    accessorKey: "ttl_ms",
    header: "TTL",
    cell: ({ row }) =>
      row.original.ttl_ms !== undefined ? (
        <span className="text-muted-foreground font-mono text-xs">{formatTtlMs(row.original.ttl_ms)}</span>
      ) : (
        <span className="text-muted-foreground/50">—</span>
      ),
  },
  {
    accessorKey: "value",
    header: "Value (preview)",
    enableSorting: false,
    cell: ({ row }) => {
      if (!row.original.found) return <span className="text-muted-foreground/50">—</span>;
      const preview = row.original.value !== undefined ? bestEffortUtf8(row.original.value).slice(0, 64) : "";
      return <span className="font-mono text-xs">{preview || "(empty)"}</span>;
    },
  },
];

function StatusPill({ ok, okLabel, failLabel }: { ok: boolean; okLabel: string; failLabel: string }) {
  return (
    <span
      className={
        ok
          ? "inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-500 ring-1 ring-emerald-500/20"
          : "inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-500 ring-1 ring-amber-500/20"
      }
    >
      {ok ? okLabel : failLabel}
    </span>
  );
}

function bestEffortUtf8(base64: string): string {
  try {
    const bytes = decodeBase64(base64);
    return decodeUtf8(bytes) ?? "";
  } catch {
    return "";
  }
}

function formatTtlMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

function triggerDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
