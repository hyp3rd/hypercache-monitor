"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ClusterMembers, MemberState } from "@/lib/api/mgmt";
import { cn } from "@/lib/utils";

/**
 * Members table with status dots — operators scan vertical rows
 * and the colored dot in the leftmost column makes the at-a-glance
 * health read trivial. Glow on alive nodes draws the eye to
 * what's healthy first; the failure modes (suspect, dead) are
 * conspicuous by color difference rather than visual noise.
 */

const stateStyles: Record<
  MemberState,
  { label: string; dot: string; ring: string; text: string }
> = {
  alive: {
    label: "Alive",
    dot: "bg-emerald-500 alive-glow",
    ring: "ring-emerald-500/30",
    text: "text-emerald-500",
  },
  suspect: {
    label: "Suspect",
    dot: "bg-amber-500 animate-pulse",
    ring: "ring-amber-500/30",
    text: "text-amber-500",
  },
  dead: {
    label: "Dead",
    dot: "bg-rose-500",
    ring: "ring-rose-500/30",
    text: "text-rose-500",
  },
  draining: {
    label: "Draining",
    dot: "bg-sky-500",
    ring: "ring-sky-500/30",
    text: "text-sky-500",
  },
};

export function MembersTable({ data }: { data: ClusterMembers }) {
  const counts = data.members.reduce<Record<MemberState, number>>(
    (acc, m) => {
      acc[m.state] = (acc[m.state] ?? 0) + 1;
      return acc;
    },
    { alive: 0, suspect: 0, dead: 0, draining: 0 },
  );

  return (
    <div>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-1.5 text-xs">
          <span className="text-muted-foreground">Replication factor</span>
          <span className="text-foreground font-mono font-semibold">
            {data.replication}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-muted-foreground">vnodes / node</span>
          <span className="text-foreground font-mono font-semibold">
            {data.virtualNodes}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {(Object.entries(counts) as Array<[MemberState, number]>)
            .filter(([, n]) => n > 0)
            .map(([state, n]) => (
              <span
                key={state}
                className={cn(
                  "bg-muted/50 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1",
                  stateStyles[state].ring,
                  stateStyles[state].text,
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    stateStyles[state].dot,
                  )}
                />
                <span className="font-mono tabular-nums">{n}</span>
                <span className="text-foreground/60">
                  {stateStyles[state].label.toLowerCase()}
                </span>
              </span>
            ))}
        </div>
      </header>
      <div className="border-border/50 overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="w-10" />
              <TableHead>Node</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Incarnation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.members.map((m) => {
              const style = stateStyles[m.state];
              return (
                <TableRow
                  key={m.id}
                  className="border-border/40 hover:bg-accent/40"
                >
                  <TableCell className="text-center">
                    <span
                      aria-hidden
                      className={cn(
                        "inline-block h-2.5 w-2.5 rounded-full",
                        style.dot,
                      )}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="text-foreground font-mono text-xs font-semibold">
                      {m.id}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {m.address}
                  </TableCell>
                  <TableCell>
                    <span className={cn("text-xs font-medium", style.text)}>
                      {style.label}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right font-mono text-xs tabular-nums">
                    {m.incarnation.toLocaleString()}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
