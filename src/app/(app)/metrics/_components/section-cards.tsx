"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpFromLine,
  ArrowUpRightFromCircle,
  BellRing,
  Boxes,
  CheckCircle2,
  CircleAlert,
  Database,
  Drama,
  Forward,
  Gauge,
  GitMerge,
  Heart,
  HeartPulse,
  Layers,
  Network,
  Radar,
  RefreshCw,
  Repeat,
  Send,
  ShieldCheck,
  Trash2,
  TrendingDown,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CacheConfig, DistMetrics } from "@/lib/api/metrics";
import type { FieldSeries, TrackedField } from "@/lib/metrics/use-metrics-polling";
import { MetricTile } from "./metric-tile";

/**
 * The seven section cards making up the dashboard. Each is a
 * thin wrapper over a list of `<MetricTile>`s — the heavy
 * lifting (rate computation, sparkline) lives in the tile
 * itself.
 *
 * One file rather than seven keeps related code colocated; each
 * section is small enough that splitting only adds import noise.
 *
 * Card ordering reflects operator scan priority: capacity (where
 * are we?), traffic (how busy?), reliability (anything failing?),
 * repair / drift (silent corruption?), membership (who's alive?),
 * hinted handoff (any backlog?), rebalance (any churn?).
 */

type Series = Record<TrackedField, FieldSeries>;

// ---- Capacity (static-ish from /config) ------------------------------

export function CapacityCard({ config }: { config: CacheConfig | undefined }) {
  return (
    <Card className="border-border/50 bg-card/60 backdrop-blur">
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <SectionIcon Icon={Database} />
        <div>
          <CardTitle>Capacity</CardTitle>
          <CardDescription>Configuration and current allocation.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {config ? (
          <ul role="list" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <ConfigCell label="Capacity" value={config.capacity.toLocaleString()} />
            <ConfigCell label="Allocation" value={config.allocation.toLocaleString()} />
            <ConfigCell
              label="Allocation / capacity"
              value={
                config.capacity > 0 ? `${((config.allocation / config.capacity) * 100).toFixed(1)}%` : "—"
              }
            />
            <ConfigCell
              label="Max cache size"
              value={config.maxCacheSize > 0 ? formatBytes(config.maxCacheSize) : "unbounded"}
            />
            <ConfigCell label="Eviction" value={config.evictionAlgorithm} mono />
            <ConfigCell label="Eviction interval" value={config.evictionInterval} mono />
            <ConfigCell label="Expiration interval" value={config.expirationInterval} mono />
            {config.replication !== undefined && (
              <ConfigCell label="Replication" value={String(config.replication)} mono />
            )}
            {config.virtualNodesPerNode !== undefined && (
              <ConfigCell label="Vnodes / node" value={String(config.virtualNodesPerNode)} mono />
            )}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No configuration data.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ConfigCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <li className="border-border/50 bg-card/50 rounded-lg border p-3">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p className={`mt-1.5 text-lg font-semibold tabular-nums ${mono ? "font-mono" : ""}`}>{value}</p>
    </li>
  );
}

// ---- Traffic --------------------------------------------------------

export function TrafficCard({ series }: { series: Series }) {
  return (
    <SectionCard
      Icon={Forward}
      title="Traffic"
      description="Forwarded ops and replica fan-out, deltas per second."
    >
      <Grid>
        <MetricTile label="Forward GET" Icon={Send} series={series.forwardGet} tone="primary" />
        <MetricTile label="Forward SET" Icon={ArrowUpFromLine} series={series.forwardSet} tone="primary" />
        <MetricTile label="Forward DELETE" Icon={Trash2} series={series.forwardRemove} tone="warning" />
        <MetricTile
          label="Replica fan-out SET"
          Icon={ArrowUp}
          series={series.replicaFanoutSet}
          tone="neutral"
        />
        <MetricTile
          label="Replica fan-out DELETE"
          Icon={ArrowDown}
          series={series.replicaFanoutRemove}
          tone="neutral"
        />
        <MetricTile
          label="Replica GET miss"
          Icon={CircleAlert}
          series={series.replicaGetMiss}
          tone="warning"
        />
      </Grid>
    </SectionCard>
  );
}

// ---- Reliability ----------------------------------------------------

export function ReliabilityCard({ series, data }: { series: Series; data: DistMetrics | undefined }) {
  const writeAcks = data?.writeAcks ?? 0;
  const writeAttempts = data?.writeAttempts ?? 0;
  const ackRate = writeAttempts > 0 ? (writeAcks / writeAttempts) * 100 : null;

  const heartbeatTotal = (data?.heartbeatSuccess ?? 0) + (data?.heartbeatFailure ?? 0);
  const probeRate = heartbeatTotal > 0 ? ((data?.heartbeatSuccess ?? 0) / heartbeatTotal) * 100 : null;

  return (
    <SectionCard
      Icon={ShieldCheck}
      title="Reliability"
      description="Write quorum, heartbeat health, indirect probe outcomes."
    >
      {(ackRate !== null || probeRate !== null) && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {probeRate !== null && (
            <HeroNumber
              label="Probe success rate"
              value={`${probeRate.toFixed(2)}%`}
              caption={`${(data?.heartbeatSuccess ?? 0).toLocaleString()} / ${heartbeatTotal.toLocaleString()} probes`}
              tone="success"
            />
          )}
          {ackRate !== null && (
            <HeroNumber
              label="Write quorum rate"
              value={`${ackRate.toFixed(2)}%`}
              caption={`${writeAcks.toLocaleString()} / ${writeAttempts.toLocaleString()} attempts`}
              tone={ackRate >= 99 ? "success" : ackRate >= 95 ? "warning" : "danger"}
            />
          )}
        </div>
      )}
      <Grid>
        <MetricTile
          label="Heartbeat success"
          Icon={HeartPulse}
          series={series.heartbeatSuccess}
          tone="success"
        />
        <MetricTile label="Heartbeat failure" Icon={Heart} series={series.heartbeatFailure} tone="warning" />
        <MetricTile
          label="Indirect probe success"
          Icon={CheckCircle2}
          series={series.indirectProbeSuccess}
          tone="success"
        />
        <MetricTile
          label="Indirect probe failure"
          Icon={XCircle}
          series={series.indirectProbeFailure}
          tone="danger"
        />
        <MetricTile
          label="Indirect probe refuted"
          Icon={Repeat}
          series={series.indirectProbeRefuted}
          tone="neutral"
        />
        <MetricTile
          label="Write quorum failures"
          Icon={AlertTriangle}
          series={series.writeQuorumFailures}
          tone="danger"
        />
      </Grid>
    </SectionCard>
  );
}

// ---- Repair / Drift -------------------------------------------------

export function RepairCard({ series, data }: { series: Series; data: DistMetrics | undefined }) {
  const lastSyncErr = data?.lastAutoSyncError ?? "";
  return (
    <SectionCard
      Icon={GitMerge}
      title="Repair & drift"
      description="Read-repair, merkle anti-entropy, version conflicts."
    >
      {lastSyncErr.length > 0 && (
        <div
          role="alert"
          className="bg-destructive/10 text-destructive ring-destructive/20 mb-4 rounded-md px-3 py-2 text-sm ring-1"
        >
          <p className="text-xs font-semibold tracking-wider uppercase">Last auto-sync error</p>
          <p className="mt-1 font-mono text-[13px] break-all">{lastSyncErr}</p>
        </div>
      )}
      <Grid>
        <MetricTile label="Read repair" Icon={RefreshCw} series={series.readRepair} tone="success" />
        <MetricTile label="Merkle syncs" Icon={Layers} series={series.merkleSyncs} tone="primary" />
        <MetricTile
          label="Merkle keys pulled"
          Icon={ArrowDownToLine}
          series={series.merkleKeysPulled}
          tone="primary"
        />
        <MetricTile label="Auto-sync loops" Icon={Radar} series={series.autoSyncLoops} tone="neutral" />
        <MetricTile label="Tombstones active" Icon={Boxes} series={series.tombstonesActive} tone="warning" />
        <MetricTile
          label="Tombstones purged"
          Icon={TrendingDown}
          series={series.tombstonesPurged}
          tone="success"
        />
        <MetricTile
          label="Version conflicts"
          Icon={AlertTriangle}
          series={series.versionConflicts}
          tone="warning"
        />
        <MetricTile label="Version tie-breaks" Icon={Drama} series={series.versionTieBreaks} tone="neutral" />
        <MetricTile
          label="Read primary promote"
          Icon={ArrowUpRightFromCircle}
          series={series.readPrimaryPromote}
          tone="neutral"
        />
      </Grid>
    </SectionCard>
  );
}

// ---- Membership / Drift --------------------------------------------

export function MembershipCard({ data, series }: { data: DistMetrics | undefined; series: Series }) {
  return (
    <SectionCard
      Icon={Users}
      title="Membership"
      description="Live state of the cluster: alive, suspect, dead."
    >
      {data && (
        <ul role="list" className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <GaugeTile label="Alive" value={data.membersAlive} tone="success" Icon={CheckCircle2} />
          <GaugeTile label="Suspect" value={data.membersSuspect} tone="warning" Icon={AlertTriangle} />
          <GaugeTile label="Dead" value={data.membersDead} tone="danger" Icon={XCircle} />
          <GaugeTile label="Membership version" value={data.membershipVersion} tone="neutral" Icon={Gauge} />
        </ul>
      )}
      <Grid>
        <MetricTile label="Drains" Icon={ArrowDown} series={series.drains} tone="neutral" />
        <MetricTile label="Nodes removed" Icon={XCircle} series={series.nodesRemoved} tone="danger" />
      </Grid>
    </SectionCard>
  );
}

// ---- Hinted handoff -------------------------------------------------

export function HintedHandoffCard({ series, data }: { series: Series; data: DistMetrics | undefined }) {
  const bytesQueued = data?.hintedBytes ?? 0;
  return (
    <SectionCard
      Icon={BellRing}
      title="Hinted handoff"
      description="Pending writes for offline replicas, replayed on recovery."
    >
      {bytesQueued > 0 && (
        <div className="mb-4">
          <HeroNumber
            label="Bytes queued"
            value={formatBytes(bytesQueued)}
            caption="Total bytes pending replay"
            tone="warning"
          />
        </div>
      )}
      <Grid>
        <MetricTile label="Queued" Icon={ArrowUp} series={series.hintedQueued} tone="warning" />
        <MetricTile label="Replayed" Icon={CheckCircle2} series={series.hintedReplayed} tone="success" />
        <MetricTile label="Expired" Icon={TrendingDown} series={series.hintedExpired} tone="neutral" />
        <MetricTile label="Dropped (per node)" Icon={XCircle} series={series.hintedDropped} tone="danger" />
        <MetricTile
          label="Dropped (global)"
          Icon={AlertTriangle}
          series={series.hintedGlobalDropped}
          tone="danger"
        />
        <MetricTile
          label="Bytes flowing"
          Icon={TrendingUp}
          series={series.hintedBytes}
          tone="neutral"
          unit=" B/s"
        />
      </Grid>
    </SectionCard>
  );
}

// ---- Rebalance ------------------------------------------------------

export function RebalanceCard({ series }: { series: Series }) {
  return (
    <SectionCard Icon={Network} title="Rebalance" description="Key migration during membership changes.">
      <Grid>
        <MetricTile label="Keys rebalanced" Icon={Repeat} series={series.rebalancedKeys} tone="primary" />
        <MetricTile label="Batches" Icon={Layers} series={series.rebalanceBatches} tone="neutral" />
        <MetricTile
          label="Primary migrations"
          Icon={ArrowUpRightFromCircle}
          series={series.rebalancedPrimary}
          tone="warning"
        />
        <MetricTile
          label="Replica diff"
          Icon={GitMerge}
          series={series.rebalancedReplicaDiff}
          tone="neutral"
        />
      </Grid>
    </SectionCard>
  );
}

// ---- Helpers --------------------------------------------------------

function SectionCard({
  Icon,
  title,
  description,
  children,
}: {
  Icon: typeof Activity;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border/50 bg-card/60 backdrop-blur">
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <SectionIcon Icon={Icon} />
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function SectionIcon({ Icon }: { Icon: typeof Activity }) {
  return (
    <span className="bg-brand-muted text-primary ring-primary/30 flex h-9 w-9 items-center justify-center rounded-md ring-1">
      <Icon aria-hidden className="h-4 w-4" />
    </span>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <ul role="list" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.isArray(children) ? children.map((c, i) => <li key={i}>{c}</li>) : <li>{children}</li>}
    </ul>
  );
}

function HeroNumber({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: string;
  caption: string;
  tone: "success" | "warning" | "danger" | "neutral";
}) {
  const tones: Record<typeof tone, string> = {
    success: "text-emerald-500",
    warning: "text-amber-500",
    danger: "text-rose-500",
    neutral: "text-violet-400",
  };
  return (
    <div className="bg-muted/40 ring-border/50 rounded-lg p-3 ring-1">
      <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tones[tone]}`}>{value}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">{caption}</p>
    </div>
  );
}

function GaugeTile({
  label,
  value,
  tone,
  Icon,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "danger" | "neutral";
  Icon: typeof Activity;
}) {
  const tones: Record<typeof tone, string> = {
    success: "text-emerald-500 bg-emerald-500/10 ring-emerald-500/20",
    warning: "text-amber-500 bg-amber-500/10 ring-amber-500/20",
    danger: "text-rose-500 bg-rose-500/10 ring-rose-500/20",
    neutral: "text-violet-400 bg-violet-500/10 ring-violet-500/20",
  };
  return (
    <li>
      <figure className="border-border/50 bg-card/50 rounded-lg border p-3">
        <div className="flex items-start justify-between gap-2">
          <figcaption className="text-muted-foreground text-xs font-medium">{label}</figcaption>
          <span className={`flex h-7 w-7 items-center justify-center rounded-md ring-1 ${tones[tone]}`}>
            <Icon aria-hidden className="h-3.5 w-3.5" />
          </span>
        </div>
        <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>
      </figure>
    </li>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
