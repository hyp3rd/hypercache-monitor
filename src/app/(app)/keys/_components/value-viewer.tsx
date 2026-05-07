"use client";

import { useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { bytesToBlob, decodeBase64, decodeUtf8, toHexDump } from "@/lib/value-decode";

/**
 * Renders the `value` field of an ItemEnvelope across four
 * representations:
 *   - Text   — UTF-8 decode (hidden when bytes aren't valid UTF-8)
 *   - Hex    — offset / hex / ASCII gloss for binary inspection
 *   - Base64 — the raw wire shape (operators sometimes need it
 *              verbatim for retry replays)
 *   - Download — emits the bytes as a Blob; safe for binary
 *                payloads that shouldn't render inline
 *
 * Decoding happens once per envelope via useMemo; tab switches
 * are free.
 */
export function ValueViewer({ keyName, base64Value }: { keyName: string; base64Value: string }) {
  const decoded = useMemo(() => {
    try {
      return decodeBase64(base64Value);
    } catch {
      return null;
    }
  }, [base64Value]);

  if (decoded === null) {
    return (
      <p className="bg-destructive/10 text-destructive ring-destructive/20 rounded-md px-3 py-2 text-sm ring-1">
        Failed to decode base64 payload. Raw value: <code className="font-mono break-all">{base64Value}</code>
      </p>
    );
  }

  // Local non-null alias so the narrowing survives across the
  // closure boundary into downloadBlob (TypeScript doesn't
  // re-narrow `decoded` after the early return inside an
  // inner function).
  const bytes = decoded;
  const utf8 = decodeUtf8(bytes);
  const defaultTab = utf8 !== null ? "text" : "hex";

  function downloadBlob() {
    const blob = bytesToBlob(bytes);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sanitizeFilename(keyName)}.bin`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Tabs defaultValue={defaultTab}>
      <div className="flex items-center justify-between gap-3">
        <TabsList>
          {utf8 !== null && <TabsTrigger value="text">Text</TabsTrigger>}
          <TabsTrigger value="hex">Hex</TabsTrigger>
          <TabsTrigger value="base64">Base64</TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground font-mono text-xs">
            {decoded.length.toLocaleString()} {decoded.length === 1 ? "byte" : "bytes"}
          </span>
          <Button variant="ghost" size="sm" className="gap-2" onClick={downloadBlob}>
            <Download aria-hidden className="h-3.5 w-3.5" />
            Download
          </Button>
        </div>
      </div>

      {utf8 !== null && (
        <TabsContent value="text">
          <pre className="bg-muted/30 ring-border/40 mt-3 max-h-96 overflow-auto rounded-md p-3 ring-1">
            <code className="text-xs break-all whitespace-pre-wrap">{utf8}</code>
          </pre>
        </TabsContent>
      )}
      <TabsContent value="hex">
        <pre className="bg-muted/30 ring-border/40 mt-3 max-h-96 overflow-auto rounded-md p-3 font-mono text-xs ring-1">
          <code>{toHexDump(decoded)}</code>
        </pre>
      </TabsContent>
      <TabsContent value="base64">
        <pre className="bg-muted/30 ring-border/40 mt-3 max-h-96 overflow-auto rounded-md p-3 font-mono text-xs ring-1">
          <code className="break-all whitespace-pre-wrap">{base64Value}</code>
        </pre>
      </TabsContent>
    </Tabs>
  );
}

/**
 * Strip filesystem-unsafe characters from a key name so the
 * downloaded file lands somewhere sensible. Cache keys can
 * contain colons / slashes / spaces; the browser would
 * otherwise refuse the suggested filename.
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "value";
}
