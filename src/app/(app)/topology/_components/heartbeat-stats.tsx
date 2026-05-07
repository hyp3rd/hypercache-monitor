"use client";

import type { Heartbeat } from "@/lib/api/mgmt";
import { cn } from "@/lib/utils";
import { Activity, AlertTriangle, ArrowUpRightFromCircle, UserMinus } from "lucide-react";

/**
 * Heartbeat stats with rich visual treatment. Each stat has its
 * own glyph + accent color so an operator can scan the row at a
 * glance — the failure counters demand a different visual weight
 * than the success ones.
 *
 * Wire shape comes from
 * `hypercache_dist.go::DistHeartbeatMetrics`:
 *   - heartbeatSuccess: probes that returned alive
 *   - heartbeatFailure: probes that timed out or errored
 *   - nodesRemoved: members removed from membership (dead → gone)
 *   - readPrimaryPromote: GETs that promoted a replica to primary
 *     because the primary was unreachable
 *
 * The success/failure ratio is computed inline and surfaced as a
 * small "hit rate" indicator — operators care about THIS more
 * than absolute counts in steady state.
 */

type Stat = {
  key: keyof Heartbeat;
  label: string;
  description: string;
  Icon: typeof Activity;
  tone: "success" | "warning" | "danger" | "neutral";
};

const STATS: Stat[] = [
  {
    key: "heartbeatSuccess",
    label: "Successful probes",
    description: "Heartbeats that returned alive",
    Icon: Activity,
    tone: "success",
  },
  {
    key: "heartbeatFailure",
    label: "Failed probes",
    description: "Timed out or returned error",
    Icon: AlertTriangle,
    tone: "warning",
  },
  {
    key: "nodesRemoved",
    label: "Nodes removed",
    description: "Dead nodes pruned from membership",
    Icon: UserMinus,
    tone: "danger",
  },
  {
    key: "readPrimaryPromote",
    label: "Primary promotions",
    description: "Replica served when primary was unreachable",
    Icon: ArrowUpRightFromCircle,
    tone: "neutral",
  },
];

const toneStyles: Record<Stat["tone"], string> = {
  success: "text-emerald-500 bg-emerald-500/10 ring-emerald-500/20",
  warning: "text-amber-500 bg-amber-500/10 ring-amber-500/20",
  danger: "text-rose-500 bg-rose-500/10 ring-rose-500/20",
  neutral: "text-violet-400 bg-violet-500/10 ring-violet-500/20",
};

export function HeartbeatStats({ data }: { data: Heartbeat }) {
  const present = STATS.filter((s) => typeof data[s.key] === "number");
  if (present.length === 0) {
    return <p className="text-muted-foreground text-sm">No heartbeat metrics reported.</p>;
  }

  const success = (data.heartbeatSuccess ?? 0) as number;
  const failure = (data.heartbeatFailure ?? 0) as number;
  const total = success + failure;
  const successRate = total > 0 ? (success / total) * 100 : null;

  return (
    <div className="space-y-4">
      {successRate !== null && (
        <div className="bg-muted/40 ring-border/50 flex items-center justify-between rounded-lg p-3 ring-1">
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              Probe success rate
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {successRate.toFixed(2)}
              <span className="text-muted-foreground ml-0.5 text-base font-normal">%</span>
            </p>
          </div>
          <div className="text-muted-foreground text-right text-xs">
            <p>
              <span className="text-foreground font-mono">{success.toLocaleString()}</span> /{" "}
              {total.toLocaleString()} probes
            </p>
          </div>
        </div>
      )}
      {/* Stat tiles render as a list of figures rather than a
       * <dl>: axe-core's `definition-list`/`dlitem` rules require
       * `<dt>`/`<dd>` to be direct children (or single-group
       * wrappers) of `<dl>`, but each tile here mixes label +
       * value + icon + description, which doesn't fit the
       * dl/dt/dd shape. <ul role="list"> with <figure> items
       * carries the same semantics for screen readers without
       * the structural violation. */}
      <ul role="list" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {present.map(({ key, label, description, Icon, tone }) => (
          <li key={String(key)}>
            <figure className="group border-border/50 bg-card/50 hover:border-border hover:bg-card relative overflow-hidden rounded-lg border p-3 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <figcaption className="text-muted-foreground text-xs font-medium">{label}</figcaption>
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-md ring-1",
                    toneStyles[tone],
                  )}
                >
                  <Icon aria-hidden className="h-3.5 w-3.5" />
                </span>
              </div>
              <p className="mt-2 font-mono text-xl font-semibold tabular-nums">
                {(data[key] as number).toLocaleString()}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">{description}</p>
            </figure>
          </li>
        ))}
      </ul>
    </div>
  );
}
