"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CacheApiError } from "@/lib/api/keys";
import { fetchKeyList, type ListKeysResponse } from "@/lib/api/keys-list";
import { queryKeys } from "@/lib/query/keys";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Master-detail "browse" side of the Keys page. Owns:
 *
 *   - the debounced search input (`q`)
 *   - cursor-walk state across pages (`cursorStack` records
 *     prior cursors so Back is free — never re-fans the cluster
 *     just to revisit a page)
 *   - TanStack Query keyed by `(clusterId, q, cursor)` so
 *     identical (filter, page) requests hit the cache
 *   - truncation + partial-node banners
 *
 * Selecting a row hands off to the parent via `onSelect` (which
 * encodes the key into `?k=` so the existing single-key inspector
 * picks it up). The component is purely browse-side — no key
 * editing happens here.
 *
 * Server-side paging matters: a 50000-key cluster can't fit in
 * one client-side TanStack Table, and the upstream caps `max` at
 * 50000 for memory safety regardless. We hold one page in memory
 * at a time.
 */

const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 250;

export function KeysBrowser({
  clusterId,
  selectedKey,
  onSelect,
}: {
  clusterId: string;
  selectedKey: string | null;
  onSelect: (next: string) => void;
}) {
  const [pattern, setPattern] = useState("");
  const debouncedPattern = useDebouncedValue(pattern, SEARCH_DEBOUNCE_MS);

  // cursorStack[i] is the cursor that *opens* page i+1. Page 0
  // is always cursor="" (the empty string means "start of
  // result set" upstream). Pushing a cursor onto the stack
  // advances; popping retreats.
  const [cursorStack, setCursorStack] = useState<string[]>([""]);

  // Reset paging when the debounced pattern changes. Done as a
  // derived-state setState during render rather than in a
  // useEffect — see https://react.dev/learn/you-might-not-need-an-effect
  // "Adjusting some state when a prop changes". Avoids the cascade
  // render that the in-effect form would trigger.
  const [trackedPattern, setTrackedPattern] = useState(debouncedPattern);
  if (trackedPattern !== debouncedPattern) {
    setTrackedPattern(debouncedPattern);
    setCursorStack([""]);
  }

  const currentCursor = cursorStack[cursorStack.length - 1] ?? "";

  const query = useQuery<ListKeysResponse, CacheApiError>({
    queryKey: queryKeys.keyList(clusterId, debouncedPattern, currentCursor),
    queryFn: () =>
      fetchKeyList(clusterId, {
        q: debouncedPattern,
        cursor: currentCursor,
        limit: PAGE_SIZE,
      }),
    // Browsing is operator-driven; don't poll. Stale data
    // surfaces on the next explicit page nav or search edit.
    refetchInterval: false,
    staleTime: 30_000,
  });

  const data = query.data;
  const pageNumber = cursorStack.length; // 1-indexed for display
  const hasPrev = cursorStack.length > 1;
  const hasNext = data ? data.nextCursor !== "" : false;

  return (
    <div className="space-y-4">
      <SearchBox
        value={pattern}
        onChange={setPattern}
      />
      <ResultBody
        query={query}
        data={data}
        selectedKey={selectedKey}
        onSelect={onSelect}
      />
      {data && (
        <PageFooter
          pageNumber={pageNumber}
          pageSize={PAGE_SIZE}
          totalMatched={data.totalMatched}
          truncated={data.truncated}
          hasPrev={hasPrev}
          hasNext={hasNext}
          onPrev={() => setCursorStack((s) => s.slice(0, -1))}
          onNext={() => setCursorStack((s) => [...s, data.nextCursor])}
        />
      )}
      {data && data.partialNodes.length > 0 && (
        <PartialNodesBanner nodes={data.partialNodes} />
      )}
    </div>
  );
}

function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label
        htmlFor="keys-browser-input"
        className="text-muted-foreground text-xs font-medium tracking-wider uppercase"
      >
        Pattern
      </Label>
      <div className="relative">
        <Search
          aria-hidden
          className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2"
        />
        <Input
          id="keys-browser-input"
          type="search"
          autoComplete="off"
          inputMode="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="user:  or  session-*  or  [ab]*"
          className="pl-8 font-mono"
        />
      </div>
      <p className="text-muted-foreground text-[11px]">
        Prefix when no glob metacharacters (<span className="font-mono">*</span>{" "}
        <span className="font-mono">?</span>{" "}
        <span className="font-mono">[</span>); glob otherwise. Empty matches
        every key.
      </p>
    </div>
  );
}

function ResultBody({
  query,
  data,
  selectedKey,
  onSelect,
}: {
  query: ReturnType<typeof useQuery<ListKeysResponse, CacheApiError>>;
  data: ListKeysResponse | undefined;
  selectedKey: string | null;
  onSelect: (next: string) => void;
}) {
  if (query.isPending) {
    return (
      <div
        className="space-y-2"
        aria-busy="true"
      >
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (query.error) {
    return <ErrorBanner error={query.error} />;
  }

  if (!data || data.keys.length === 0) {
    return (
      <div className="border-border/50 rounded-md border border-dashed p-6 text-center">
        <p className="text-muted-foreground text-sm">
          {data?.totalMatched === 0
            ? "No keys match this pattern."
            : "Type a pattern to browse keys."}
        </p>
      </div>
    );
  }

  return (
    <div className="border-border/50 rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.keys.map((key) => (
            <TableRow
              key={key}
              data-state={key === selectedKey ? "selected" : undefined}
              className={cn(
                "cursor-pointer",
                key === selectedKey && "bg-muted/60",
              )}
              onClick={() => onSelect(key)}
            >
              <TableCell className="font-mono text-xs break-all">
                {key}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PageFooter({
  pageNumber,
  pageSize,
  totalMatched,
  truncated,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  pageNumber: number;
  pageSize: number;
  totalMatched: number;
  truncated: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalMatched / pageSize));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <p className="text-muted-foreground">
          Page <span className="font-mono">{pageNumber}</span> of{" "}
          <span className="font-mono">{totalPages}</span>{" "}
          <span aria-hidden>·</span>{" "}
          <span className="font-mono">{totalMatched}</span>{" "}
          {totalMatched === 1 ? "key" : "keys"}
          {truncated && (
            <>
              {" "}
              <span aria-hidden>·</span>{" "}
              <span className="text-amber-600 dark:text-amber-400">capped</span>
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasPrev}
            onClick={onPrev}
            aria-label="Previous page"
          >
            <ChevronLeft
              aria-hidden
              className="h-4 w-4"
            />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasNext}
            onClick={onNext}
            aria-label="Next page"
          >
            <ChevronRight
              aria-hidden
              className="h-4 w-4"
            />
          </Button>
        </div>
      </div>
      {truncated && <TruncatedBanner />}
    </div>
  );
}

function TruncatedBanner() {
  return (
    <div
      role="status"
      className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-500/20 dark:text-amber-200"
    >
      <span className="font-medium">Result set capped.</span> Refine the pattern
      to see all matching keys — the upstream limits a single enumeration to
      10,000 keys to bound memory.
    </div>
  );
}

function PartialNodesBanner({ nodes }: { nodes: string[] }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-500/20 dark:text-amber-200"
    >
      <AlertTriangle
        aria-hidden
        className="mt-0.5 h-4 w-4 flex-none"
      />
      <p>
        <span className="font-medium">Partial result.</span> Could not reach{" "}
        <span className="font-mono">{nodes.join(", ")}</span> during fan-out.
        Their keys may be missing from this page.
      </p>
    </div>
  );
}

function ErrorBanner({ error }: { error: CacheApiError }) {
  return (
    <div
      role="alert"
      className="bg-destructive/10 text-destructive ring-destructive/20 rounded-md px-3 py-2 text-sm ring-1"
    >
      <span className="font-mono text-xs tracking-wider uppercase">
        {error.code}
      </span>
      <span className="ml-2">{error.message}</span>
    </div>
  );
}

/**
 * Single-purpose debounce hook for the search input. Returns
 * `value` only after `delayMs` of stillness. Inlined here
 * rather than extracted because (a) it's the only consumer
 * today and (b) every variant of this in the wild has subtle
 * differences (leading edge, trailing edge, cancellation
 * semantics) — having one definition per use site beats a
 * generic helper that needs flags.
 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}

// Re-export the typed ListKeysResponse so KeysBrowser consumers
// can reflect on the shape without importing from `keys-list.ts`
// directly — keeps the surface narrow.
export type { ListKeysResponse };
