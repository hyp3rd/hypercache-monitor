"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchKey, type CacheApiError } from "@/lib/api/keys";
import { queryKeys } from "@/lib/query/keys";
import { Database, KeyRound } from "lucide-react";
import { KeySearch } from "./key-search";
import { KeyDetail } from "./key-detail";

/**
 * Orchestrator for the Single-Key Inspector. Owns:
 *   - URL search param `?k=...` as the source of truth for the
 *     active key (refresh-survives, back-button-works,
 *     shareable links).
 *   - Loading/error/empty states for the active key.
 *   - Layout: search panel on top, detail card below.
 *
 * The detail card itself owns the value-decode toggle, edit
 * form, and delete confirmation — keeping this orchestrator
 * a thin shell.
 */
export function KeysClient({ clusterId, initialKey }: { clusterId: string; initialKey: string | null }) {
  const router = useRouter();
  const search = useSearchParams();
  const activeKey = search.get("k") ?? initialKey;

  const setKey = useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(search.toString());
      if (next === null || next === "") {
        params.delete("k");
      } else {
        params.set("k", next);
      }
      const query = params.toString();
      router.push(query ? `/keys?${query}` : `/keys`);
    },
    [router, search],
  );

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
      <Card className="border-border/50 bg-card/60 xl:sticky xl:top-0 xl:col-span-4 xl:self-start">
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <SectionIcon Icon={KeyRound} />
          <div>
            <CardTitle>Lookup</CardTitle>
            <CardDescription>Load a key by name. Values are fetched on demand.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <KeySearch initialKey={activeKey ?? ""} onSubmit={setKey} />
        </CardContent>
      </Card>

      <div className="xl:col-span-8">
        {activeKey === null ? (
          <EmptyState />
        ) : (
          <KeyResolver clusterId={clusterId} keyName={activeKey} onChange={setKey} />
        )}
      </div>
    </div>
  );
}

function KeyResolver({
  clusterId,
  keyName,
  onChange,
}: {
  clusterId: string;
  keyName: string;
  onChange: (next: string | null) => void;
}) {
  const query = useQuery({
    queryKey: queryKeys.key(clusterId, keyName),
    queryFn: () => fetchKey(clusterId, keyName),
    // Single-key reads are explicit operator actions; don't
    // poll behind their back. They can hit refresh.
    refetchInterval: false,
    staleTime: 0,
  });

  if (query.isLoading) {
    return (
      <Card className="border-border/50 bg-card/60">
        <CardHeader>
          <CardTitle className="font-mono text-base">{keyName}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (query.error) {
    return <ErrorState clusterId={clusterId} keyName={keyName} error={query.error as CacheApiError} />;
  }

  return (
    <KeyDetail
      clusterId={clusterId}
      keyName={keyName}
      envelope={query.data ?? null}
      onAfterDelete={() => onChange(null)}
      onAfterPut={() => query.refetch()}
    />
  );
}

function EmptyState() {
  return (
    <Card className="border-border/50 bg-card/40 border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-3 p-12 text-center">
        <span className="bg-brand-muted text-primary ring-primary/30 flex h-12 w-12 items-center justify-center rounded-full ring-1">
          <Database aria-hidden className="h-5 w-5" />
        </span>
        <div>
          <p className="text-foreground text-sm font-medium">No key selected</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Type a key name on the left and press Enter to inspect it.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ErrorState({
  clusterId,
  keyName,
  error,
}: {
  clusterId: string;
  keyName: string;
  error: CacheApiError;
}) {
  return (
    <Card className="border-border/50 bg-card/60">
      <CardHeader>
        <CardTitle className="font-mono text-base break-all">{keyName}</CardTitle>
        <CardDescription className="font-mono text-xs">{clusterId}</CardDescription>
      </CardHeader>
      <CardContent>
        <p
          className="bg-destructive/10 text-destructive ring-destructive/20 rounded-md px-3 py-2 text-sm ring-1"
          role="alert"
        >
          <span className="font-mono text-xs tracking-wider uppercase">{error.code}</span>
          <span className="ml-2">{error.message}</span>
        </p>
      </CardContent>
    </Card>
  );
}

function SectionIcon({ Icon }: { Icon: typeof KeyRound }) {
  return (
    <span className="bg-brand-muted text-primary ring-primary/30 flex h-9 w-9 items-center justify-center rounded-md ring-1">
      <Icon aria-hidden className="h-4 w-4" />
    </span>
  );
}
