"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { ItemEnvelope } from "@/lib/api/keys";
import { decodeBase64, decodeUtf8 } from "@/lib/value-decode";
import { Pencil, X } from "lucide-react";
import { OwnersStrip } from "./owners-strip";
import { ValueViewer } from "./value-viewer";
import { KeyForm } from "./key-form";
import { DeleteKeyButton } from "./delete-key-button";

/**
 * Detail card for a single key. Two modes:
 *   - read mode (default): metadata + owners strip +
 *     ValueViewer (text/hex/base64/download) + Edit/Delete
 *     actions
 *   - edit mode: KeyForm with the current value pre-filled
 *     (UTF-8 decode when valid, otherwise the bare base64
 *     payload as a starting point)
 *
 * When `envelope` is null the key didn't exist on read —
 * we render an empty-state card with a "Create" button that
 * jumps straight to the form. PUT against a non-existent key
 * is the same operation as updating; the cache doesn't
 * distinguish create-vs-update at the wire.
 */
export function KeyDetail({
  clusterId,
  keyName,
  envelope,
  onAfterDelete,
  onAfterPut,
}: {
  clusterId: string;
  keyName: string;
  envelope: ItemEnvelope | null;
  onAfterDelete: () => void;
  onAfterPut: () => void;
}) {
  // editing only governs the read-mode → form toggle inside
  // the populated-envelope branch. The not-found fallback
  // renders its own form unconditionally and doesn't read
  // this flag, so initializing to `false` is correct — and
  // crucially avoids the stale-true that persisted across
  // the null → value transition after a successful create.
  const [editing, setEditing] = useState(false);

  if (envelope === null) {
    return (
      <Card className="border-border/50 bg-card/60">
        <CardHeader>
          <CardTitle className="font-mono text-base break-all">{keyName}</CardTitle>
          <CardDescription>
            Not found. The cache reports no value for this key — store one below to create it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KeyForm clusterId={clusterId} keyName={keyName} initialBody="" onAfterPut={onAfterPut} />
        </CardContent>
      </Card>
    );
  }

  const initialBody = textValueOf(envelope.value);

  return (
    <Card className="border-border/50 bg-card/60">
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="font-mono text-base break-all">{keyName}</CardTitle>
            <CardDescription className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <Metadata label="Version">{envelope.version}</Metadata>
              {envelope.origin && (
                <Metadata label="Origin" mono>
                  {envelope.origin}
                </Metadata>
              )}
              {envelope.ttl_ms !== undefined && envelope.ttl_ms > 0 && (
                <Metadata label="TTL">{formatTtlMs(envelope.ttl_ms)}</Metadata>
              )}
              {envelope.expires_at && <Metadata label="Expires">{envelope.expires_at}</Metadata>}
              {envelope.last_updated && <Metadata label="Updated">{envelope.last_updated}</Metadata>}
              <Metadata label="Node" mono>
                {envelope.node}
              </Metadata>
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant={editing ? "secondary" : "outline"}
              size="sm"
              className="gap-2"
              onClick={() => setEditing((e) => !e)}
            >
              {editing ? (
                <>
                  <X aria-hidden className="h-3.5 w-3.5" />
                  Cancel
                </>
              ) : (
                <>
                  <Pencil aria-hidden className="h-3.5 w-3.5" />
                  Edit
                </>
              )}
            </Button>
            <DeleteKeyButton clusterId={clusterId} keyName={keyName} onAfterDelete={onAfterDelete} />
          </div>
        </div>
        <OwnersStrip owners={envelope.owners} node={envelope.node} />
      </CardHeader>
      <Separator className="bg-border/40" />
      <CardContent className="pt-6">
        {editing ? (
          <KeyForm
            clusterId={clusterId}
            keyName={keyName}
            initialBody={initialBody}
            onAfterPut={() => {
              setEditing(false);
              onAfterPut();
            }}
          />
        ) : (
          <ValueViewer keyName={keyName} base64Value={envelope.value} />
        )}
      </CardContent>
    </Card>
  );
}

function Metadata({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted-foreground/70 text-[10px] font-semibold tracking-[0.18em] uppercase">
        {label}
      </span>
      <span className={mono ? "text-foreground font-mono" : "text-foreground"}>{children}</span>
    </span>
  );
}

function formatTtlMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/**
 * Best-effort decode of the base64 value to UTF-8 for the
 * edit form's initial state. Falls back to the bare base64
 * string when the bytes aren't valid UTF-8 — the operator
 * sees what they can paste back without surprises.
 *
 * Pure function (no hooks) — name deliberately avoids `use`
 * so React's hook-detector doesn't classify it as a hook
 * and refuse the conditional call site in KeyDetail.
 */
function textValueOf(base64: string): string {
  try {
    const bytes = decodeBase64(base64);
    return decodeUtf8(bytes) ?? base64;
  } catch {
    return base64;
  }
}
