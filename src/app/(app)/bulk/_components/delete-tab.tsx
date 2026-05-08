"use client";

import { DataTable } from "@/components/data-table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { batchDelete, type BatchDeleteResult } from "@/lib/api/bulk";
import { runChunked, type ChunkProgress } from "@/lib/bulk/chunk";
import { useState } from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { BulkProgress } from "./bulk-progress";
import { KeysInput } from "./keys-input";

/**
 * Bulk delete with two-step confirmation:
 *
 *   1. Operator pastes/uploads keys, clicks "Delete N keys".
 *   2. AlertDialog opens showing the count and a preview of the
 *      first 5 keys; operator must explicitly click "Confirm
 *      delete" — there's no Enter-key shortcut, no
 *      defaultFocus on the destructive action, no auto-dismiss.
 *
 * The dialog is the *only* way to start the request — the
 * primary button on the form opens the dialog, not the
 * fetcher. That eliminates the muscle-memory "click run, then
 * realize" pattern that loses prod data.
 */
export function DeleteTab({ clusterId }: { clusterId: string }) {
  const [keys, setKeys] = useState<string[]>([]);
  const [results, setResults] = useState<BatchDeleteResult[]>([]);
  const [progress, setProgress] = useState<ChunkProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function run() {
    setConfirmOpen(false);
    setRunning(true);
    setError(null);
    setResults([]);
    setProgress(null);

    try {
      const out = await runChunked({
        items: keys,
        fetcher: async (chunk) => {
          const resp = await batchDelete(clusterId, chunk);
          return resp.results;
        },
        onChunkResults: (rows) => setResults((prev) => prev.concat(rows)),
        onProgress: setProgress,
      });
      const deleted = out.results.filter((r) => r.deleted).length;
      const failed = out.results.length - deleted;
      toast[failed === 0 ? "success" : "warning"](
        `Deleted ${deleted.toLocaleString()} of ${out.results.length.toLocaleString()}`,
        {
          description: failed === 0 ? "All keys removed." : `${failed} key(s) failed — see results table.`,
        },
      );
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      toast.error("Bulk delete failed", { description: message });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="border-border/50 bg-card/40 space-y-4 rounded-lg border p-4">
        <KeysInput
          label="Keys to delete"
          onKeysChange={setKeys}
          placeholder="user:1234\nstale:session:*\nevicted-2024-03"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs">
            Chunked at 1,000 keys per request. A two-step confirmation runs before any keys are removed.
          </p>
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={running || keys.length === 0}>
                <Trash2 aria-hidden className="mr-1.5 h-3.5 w-3.5" />
                {running ? "Running…" : `Delete ${keys.length.toLocaleString()}`}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {keys.length.toLocaleString()} keys?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the selected keys from the cluster. There is no undo.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="border-border/50 bg-card/50 max-h-40 overflow-auto rounded-md border p-2 font-mono text-[11px]">
                {keys.slice(0, 5).map((k) => (
                  <p key={k} className="truncate">
                    {k}
                  </p>
                ))}
                {keys.length > 5 && (
                  <p className="text-muted-foreground mt-1">
                    … and {(keys.length - 5).toLocaleString()} more
                  </p>
                )}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={run} className="bg-destructive hover:bg-destructive/90">
                  Confirm delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
              {results.filter((r) => r.deleted).length.toLocaleString()}
            </span>{" "}
            deleted ·{" "}
            <span className="text-foreground font-mono">
              {results.filter((r) => !r.deleted).length.toLocaleString()}
            </span>{" "}
            failed
          </p>
          <DataTable columns={deleteColumns} data={results} filterPlaceholder="Filter by key…" />
        </div>
      )}
    </div>
  );
}

const deleteColumns: ColumnDef<BatchDeleteResult>[] = [
  {
    accessorKey: "key",
    header: "Key",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.key}</span>,
  },
  {
    accessorKey: "deleted",
    header: "Status",
    cell: ({ row }) => (
      <span
        className={
          row.original.deleted
            ? "inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-500 ring-1 ring-emerald-500/20"
            : "inline-flex items-center rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-500 ring-1 ring-rose-500/20"
        }
      >
        {row.original.deleted ? "deleted" : "failed"}
      </span>
    ),
  },
  {
    accessorKey: "error",
    header: "Error",
    enableSorting: false,
    cell: ({ row }) => {
      if (row.original.deleted) return <span className="text-muted-foreground/50">—</span>;
      return (
        <span className="text-destructive font-mono text-xs">
          {row.original.code ? `[${row.original.code}] ` : ""}
          {row.original.error ?? "(no message)"}
        </span>
      );
    },
  },
];
