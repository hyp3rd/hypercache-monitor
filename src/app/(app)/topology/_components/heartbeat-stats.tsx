"use client";

import type { Heartbeat } from "@/lib/api/mgmt";
import { Activity, AlertTriangle, ArrowUpRightFromCircle, UserMinus } from "lucide-react";
import { cn } from "@/lib/utils";

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
    return <p className="text-sm text-muted-foreground">No heartbeat metrics reported.</p>;
  }

  const success = (data.heartbeatSuccess ?? 0) as number;
  const failure = (data.heartbeatFailure ?? 0) as number;
  const total = success + failure;
  const successRate = total > 0 ? (success / total) * 100 : null;

  return (
    <div className="space-y-4">
      {successRate !== null && (
        <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3 ring-1 ring-border/50">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Probe success rate</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {successRate.toFixed(2)}
              <span className="ml-0.5 text-base font-normal text-muted-foreground">%</span>
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>
              <span className="font-mono text-foreground">{success.toLocaleString()}</span> / {total.toLocaleString()} probes
            </p>
          </div>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {present.map(({ key, label, description, Icon, tone }) => (
          <div
            key={String(key)}
            className="group relative overflow-hidden rounded-lg border border-border/50 bg-card/50 p-3 transition-colors hover:border-border hover:bg-card"
          >
            <div className="flex items-start justify-between gap-2">
              <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
              <span className={cn("flex h-7 w-7 items-center justify-center rounded-md ring-1", toneStyles[tone])}>
                <Icon aria-hidden className="h-3.5 w-3.5" />
              </span>
            </div>
            <dd className="mt-2 font-mono text-xl font-semibold tabular-nums">
              {(data[key] as number).toLocaleString()}
            </dd>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
        ))}
      </dl>
    </div>
  );
}
