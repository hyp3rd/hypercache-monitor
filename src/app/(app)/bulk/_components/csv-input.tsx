"use client";

import { Button } from "@/components/ui/button";
import type { BatchPutItem } from "@/lib/api/bulk";
import { CsvParseError, parseCsv } from "@/lib/csv/csv";
import { useRef, useState } from "react";
import { Upload, FileText, AlertTriangle } from "lucide-react";

/**
 * CSV upload for the Put tab. Strict header contract:
 *
 *   - REQUIRED columns: `key`, `value`
 *   - OPTIONAL columns: `ttl_ms` (integer), `value_encoding`
 *     (`"base64"` for binary; otherwise UTF-8)
 *
 * Validation is done up-front and surfaces as an inline error
 * banner rather than a toast: the operator needs to *see* what
 * went wrong, in the input region, to fix it.
 *
 * The first 3 rows are previewed under the upload button so a
 * paste-the-wrong-file mistake is caught before clicking Run.
 */
export function CsvInput({ onItemsChange }: { onItemsChange: (items: BatchPutItem[]) => void }) {
  const [items, setItems] = useState<BatchPutItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setFilename(file.name);
    const text = await file.text();
    try {
      const rows = parseCsv(text);
      const validated = validateBatchPutRows(rows);
      setItems(validated);
      setError(null);
      onItemsChange(validated);
    } catch (e) {
      setError((e as Error).message);
      setItems([]);
      onItemsChange([]);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-sm font-medium">CSV input</p>
        <p className="text-muted-foreground text-xs">
          Required columns: <span className="text-foreground font-mono">key</span>,{" "}
          <span className="text-foreground font-mono">value</span>. Optional:{" "}
          <span className="text-foreground font-mono">ttl_ms</span>,{" "}
          <span className="text-foreground font-mono">value_encoding</span> (use{" "}
          <span className="text-foreground font-mono">base64</span> for binary payloads).
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="sr-only"
          aria-label="Upload CSV"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
          <Upload aria-hidden className="mr-1.5 h-3.5 w-3.5" />
          Upload .csv
        </Button>
        {filename && (
          <span className="text-muted-foreground inline-flex items-center gap-1 font-mono text-xs">
            <FileText aria-hidden className="h-3 w-3" />
            {filename} · {items.length.toLocaleString()} {items.length === 1 ? "item" : "items"}
          </span>
        )}
      </div>
      {error !== null && (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive ring-destructive/20 inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm ring-1"
        >
          <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span className="font-mono text-xs">{error}</span>
        </p>
      )}
      {items.length > 0 && (
        <details className="border-border/50 bg-card/50 rounded-md border p-3 text-xs">
          <summary className="text-muted-foreground cursor-pointer font-medium">
            Preview first {Math.min(3, items.length)} items
          </summary>
          <pre className="mt-2 overflow-x-auto font-mono text-[11px]">
            {items
              .slice(0, 3)
              .map((it) => JSON.stringify(it))
              .join("\n")}
          </pre>
        </details>
      )}
    </div>
  );
}

/**
 * Map header-row CSV records to typed `BatchPutItem`s. Strict
 * about required columns; `ttl_ms` must parse as a non-negative
 * integer if present; `value_encoding`, if present, must be the
 * literal `"base64"` (anything else is rejected loud rather than
 * silently treated as text — the operator probably mistyped).
 */
function validateBatchPutRows(rows: Record<string, string>[]): BatchPutItem[] {
  if (rows.length === 0) {
    throw new CsvParseError("no rows after header — nothing to upload", 2);
  }
  const first = rows[0]!;
  if (!("key" in first) || !("value" in first)) {
    throw new CsvParseError(
      `header missing required columns: need 'key' and 'value', got ${Object.keys(first).join(",")}`,
      1,
    );
  }
  const items: BatchPutItem[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const key = r.key ?? "";
    if (key === "") {
      throw new CsvParseError("empty 'key' field", i + 2);
    }
    const item: BatchPutItem = { key, value: r.value ?? "" };
    if (r.ttl_ms !== undefined && r.ttl_ms !== "") {
      const n = Number(r.ttl_ms);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        throw new CsvParseError(`'ttl_ms' must be a non-negative integer, got ${r.ttl_ms}`, i + 2);
      }
      item.ttl_ms = n;
    }
    if (r.value_encoding !== undefined && r.value_encoding !== "") {
      if (r.value_encoding !== "base64") {
        throw new CsvParseError(
          `'value_encoding' must be 'base64' (or omitted for UTF-8), got ${r.value_encoding}`,
          i + 2,
        );
      }
      item.value_encoding = "base64";
    }
    items.push(item);
  }
  return items;
}
