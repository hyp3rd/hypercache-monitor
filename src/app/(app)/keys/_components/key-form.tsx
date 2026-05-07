"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CacheApiError, putKey } from "@/lib/api/keys";
import { queryKeys } from "@/lib/query/keys";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

const TTL_PATTERN = /^[0-9]+(\.[0-9]+)?(?:(?:ns|us|µs|ms|s|m|h))+$/;

/**
 * PUT form for a single key. Two inputs:
 *   - Value: textarea (UTF-8 string; sent as application/octet-stream).
 *   - TTL: optional Go duration (`30s`, `5m`, `2h30m`).
 *     Cache parses with `time.ParseDuration`, so the
 *     pattern here mirrors that grammar.
 *
 * Binary-payload upload via file picker is intentionally
 * deferred — the `cmd/hypercache-server`'s `body_limit`
 * defaults to fiber's 4 MiB and we'd want a size guard +
 * confirmation for anything larger. Phase B follow-up.
 *
 * Write-scope verification is lazy: a 401/403 from the cache
 * surfaces as an inline toast with the cache's `code`
 * field. The login probe only checks read scope (no junk
 * keys), so the first failed PUT here is the operator's
 * first signal that their token lacks write.
 */
export function KeyForm({
  clusterId,
  keyName,
  initialBody,
  onAfterPut,
}: {
  clusterId: string;
  keyName: string;
  initialBody: string;
  onAfterPut: () => void;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState(initialBody);
  const [ttl, setTtl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (ttl.trim() !== "" && !TTL_PATTERN.test(ttl.trim())) {
      setError("TTL must be a Go duration like `30s`, `5m`, or `2h30m`.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await putKey({
          clusterId,
          key: keyName,
          body,
          ttl: ttl.trim() || undefined,
        });
        await qc.invalidateQueries({ queryKey: queryKeys.key(clusterId, keyName) });
        toast.success(
          `Stored ${result.bytes.toLocaleString()} byte${result.bytes === 1 ? "" : "s"} on ${result.owners.length} owner${result.owners.length === 1 ? "" : "s"}`,
        );
        onAfterPut();
      } catch (err) {
        const e = err as CacheApiError;
        setError(`${e.code ?? "ERROR"}: ${e.message ?? "unknown failure"}`);
      }
    });
  }

  const dirty = body !== initialBody || ttl !== "";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label
          htmlFor="key-body"
          className="text-muted-foreground text-xs font-medium tracking-wider uppercase"
        >
          Value (UTF-8)
        </Label>
        <Textarea
          id="key-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="min-h-32 font-mono"
          placeholder="hello world"
        />
      </div>
      <div className="space-y-2">
        <Label
          htmlFor="key-ttl"
          className="text-muted-foreground text-xs font-medium tracking-wider uppercase"
        >
          TTL (optional · Go duration)
        </Label>
        <Input
          id="key-ttl"
          type="text"
          autoComplete="off"
          value={ttl}
          onChange={(e) => setTtl(e.target.value)}
          placeholder="30s · 5m · 2h30m"
          className="font-mono"
        />
        <p className="text-muted-foreground text-xs">
          Empty → no expiration. Examples: <code className="font-mono">30s</code>,{" "}
          <code className="font-mono">5m</code>, <code className="font-mono">2h30m</code>.
        </p>
      </div>
      {error !== null && (
        <p
          className="bg-destructive/10 text-destructive ring-destructive/20 rounded-md px-3 py-2 text-sm ring-1"
          role="alert"
        >
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending || !dirty} className="gap-2">
        {pending ? (
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save aria-hidden className="h-3.5 w-3.5" />
        )}
        {pending ? "Storing…" : "Store"}
      </Button>
    </form>
  );
}
