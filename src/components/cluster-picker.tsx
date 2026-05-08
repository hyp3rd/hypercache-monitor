"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronsUpDown, Loader2, Server, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Cluster picker. Renders the active cluster + identity badge
 * and lists every other cluster the registry knows about.
 *
 * Phase C1 wired the "Other clusters" items: clicking POSTs to
 * `/api/auth/switch-cluster`. On 200 → `router.refresh()` so
 * every server component re-renders against the new active
 * cluster. On 401 NEED_LOGIN → push the operator to
 * `/login?cluster=<id>` to bind credentials for that cluster.
 *
 * Single-cluster deployments (registry has one entry) see the
 * same "Multi-cluster lands in Phase C" placeholder as before
 * — wiring the click is conditioned on `others.length > 0`.
 */
export function ClusterPicker({
  clusters,
  activeId,
  identity,
}: {
  clusters: { id: string; name: string }[];
  activeId: string;
  identity: string;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const active = clusters.find((c) => c.id === activeId);
  const others = clusters.filter((c) => c.id !== activeId);

  function onSwitch(targetId: string) {
    if (pendingId !== null) return;
    setError(null);
    setPendingId(targetId);

    startTransition(async () => {
      let response: Response;
      try {
        response = await fetch("/api/auth/switch-cluster", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clusterId: targetId }),
        });
      } catch (err) {
        setError(`switch failed: ${(err as Error).message}`);
        setPendingId(null);
        return;
      }

      if (response.status === 401) {
        // Server says "no session bound for this cluster" —
        // route to login with the cluster preselected so the
        // operator only has to paste a token.
        router.push(`/login?cluster=${encodeURIComponent(targetId)}`);
        return;
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `switch failed (${response.status})`);
        setPendingId(null);
        return;
      }

      router.refresh();
      setPendingId(null);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-3 px-3">
          <span className="bg-brand-muted text-primary flex h-7 w-7 items-center justify-center rounded-md">
            <Server aria-hidden className="h-3.5 w-3.5" />
          </span>
          <span className="flex flex-col items-start leading-tight">
            <span className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">
              Cluster
            </span>
            <span className="font-semibold">{active?.name ?? activeId}</span>
          </span>
          <span aria-hidden className="bg-border/60 mx-1 h-6 w-px" />
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <User aria-hidden className="h-3 w-3" />
            <span className="text-foreground font-mono font-medium">{identity}</span>
          </span>
          <ChevronsUpDown aria-hidden className="text-muted-foreground h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-muted-foreground text-[10px] font-semibold tracking-[0.18em] uppercase">
          Active cluster
        </DropdownMenuLabel>
        <DropdownMenuItem disabled className="font-medium">
          {active?.name ?? activeId}
        </DropdownMenuItem>
        {others.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-[10px] font-semibold tracking-[0.18em] uppercase">
              Other clusters
            </DropdownMenuLabel>
            {others.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onSelect={(e) => {
                  // Keep the menu mounted so the spinner shows;
                  // it auto-closes on router.refresh / push.
                  e.preventDefault();
                  onSwitch(c.id);
                }}
                disabled={pendingId !== null}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex flex-col">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground font-mono text-[10px]">{c.id}</span>
                </span>
                {pendingId === c.id ? (
                  <Loader2 aria-hidden className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
                ) : null}
              </DropdownMenuItem>
            ))}
            {error !== null && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled
                  className="text-destructive text-xs whitespace-normal"
                  role="alert"
                >
                  {error}
                </DropdownMenuItem>
              </>
            )}
          </>
        ) : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className="text-muted-foreground text-xs">
              Single-cluster deployment.
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
