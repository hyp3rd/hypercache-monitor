"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronsUpDown, Server, User } from "lucide-react";

/**
 * Cluster picker. Phase A only ever has one cluster, so this
 * mostly acts as an identity badge — show the active cluster
 * name + the operator's resolved identity in the topbar.
 * Phase C wires real switching against a config-file-driven
 * registry (search palette via Cmd+K).
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
  const active = clusters.find((c) => c.id === activeId);
  const others = clusters.filter((c) => c.id !== activeId);

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
              <DropdownMenuItem key={c.id}>{c.name}</DropdownMenuItem>
            ))}
          </>
        ) : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className="text-muted-foreground text-xs">
              Multi-cluster lands in Phase C.
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
