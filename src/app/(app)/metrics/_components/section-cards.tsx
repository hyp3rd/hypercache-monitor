"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CacheConfig, DistMetrics } from "@/lib/api/metrics";
import type {
  FieldSeries,
  TrackedField,
} from "@/lib/metrics/use-metrics-polling";
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
  FlaskConical,
  Forward,
  Gauge,
  GitMerge,
  Heart,
  HeartPulse,
  Layers,
  Network,
  PackagePlus,
  Radar,
  RefreshCw,
  Repeat,
  Send,
  ShieldCheck,
  Shuffle,
  Timer,
  Trash2,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { metricInfo } from "./metric-descriptions";
import { MetricInfo, type MetricInfoContent } from "./metric-info";
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
          <CardDescription>
            Configuration and current allocation.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {config ? (
          <ul
            role="list"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          >
            <ConfigCell
              label="Capacity"
              value={config.capacity.toLocaleString()}
            />
            <ConfigCell
              label="Allocation"
              value={config.allocation.toLocaleString()}
            />
            <ConfigCell
              label="Allocation / capacity"
              value={
                config.capacity > 0
                  ? `${((config.allocation / config.capacity) * 100).toFixed(1)}%`
                  : "—"
              }
            />
            <ConfigCell
              label="Max cache size"
              value={
                config.maxCacheSize > 0
                  ? formatBytes(config.maxCacheSize)
                  : "unbounded"
              }
            />
            <ConfigCell
              label="Eviction"
              value={config.evictionAlgorithm}
              mono
            />
            <ConfigCell
              label="Eviction interval"
              value={config.evictionInterval}
              mono
            />
            <ConfigCell
              label="Expiration interval"
              value={config.expirationInterval}
              mono
            />
            {config.replication !== undefined && (
              <ConfigCell
                label="Replication"
                value={String(config.replication)}
                mono
              />
            )}
            {config.virtualNodesPerNode !== undefined && (
              <ConfigCell
                label="Vnodes / node"
                value={String(config.virtualNodesPerNode)}
                mono
              />
            )}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            No configuration data.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ConfigCell({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <li className="border-border/50 bg-card/50 rounded-lg border p-3">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p
        className={`mt-1.5 text-lg font-semibold tabular-nums ${mono ? "font-mono" : ""}`}
      >
        {value}
      </p>
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
        <MetricTile
          label="Forward GET"
          Icon={Send}
          series={series.forwardGet}
          tone="primary"
          info={metricInfo.forwardGet}
        />
        <MetricTile
          label="Forward SET"
          Icon={ArrowUpFromLine}
          series={series.forwardSet}
          tone="primary"
          info={metricInfo.forwardSet}
        />
        <MetricTile
          label="Forward DELETE"
          Icon={Trash2}
          series={series.forwardRemove}
          tone="warning"
          info={metricInfo.forwardRemove}
        />
        <MetricTile
          label="Replica fan-out SET"
          Icon={ArrowUp}
          series={series.replicaFanoutSet}
          tone="neutral"
          info={metricInfo.replicaFanoutSet}
        />
        <MetricTile
          label="Replica fan-out DELETE"
          Icon={ArrowDown}
          series={series.replicaFanoutRemove}
          tone="neutral"
          info={metricInfo.replicaFanoutRemove}
        />
        <MetricTile
          label="Replica GET miss"
          Icon={CircleAlert}
          series={series.replicaGetMiss}
          tone="warning"
          info={metricInfo.replicaGetMiss}
        />
      </Grid>
    </SectionCard>
  );
}

// ---- Reliability ----------------------------------------------------

export function ReliabilityCard({
  series,
  data,
}: {
  series: Series;
  data: DistMetrics | undefined;
}) {
  const writeAcks = data?.writeAcks ?? 0;
  const writeAttempts = data?.writeAttempts ?? 0;
  const ackRate = writeAttempts > 0 ? (writeAcks / writeAttempts) * 100 : null;

  const heartbeatTotal =
    (data?.heartbeatSuccess ?? 0) + (data?.heartbeatFailure ?? 0);
  const probeRate =
    heartbeatTotal > 0
      ? ((data?.heartbeatSuccess ?? 0) / heartbeatTotal) * 100
      : null;

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
              info={metricInfo.probeRate}
            />
          )}
          {ackRate !== null && (
            <HeroNumber
              label="Write quorum rate"
              value={`${ackRate.toFixed(2)}%`}
              caption={`${writeAcks.toLocaleString()} / ${writeAttempts.toLocaleString()} attempts`}
              tone={
                ackRate >= 99 ? "success" : ackRate >= 95 ? "warning" : "danger"
              }
              info={metricInfo.ackRate}
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
          info={metricInfo.heartbeatSuccess}
        />
        <MetricTile
          label="Heartbeat failure"
          Icon={Heart}
          series={series.heartbeatFailure}
          tone="warning"
          info={metricInfo.heartbeatFailure}
        />
        <MetricTile
          label="Indirect probe success"
          Icon={CheckCircle2}
          series={series.indirectProbeSuccess}
          tone="success"
          info={metricInfo.indirectProbeSuccess}
        />
        <MetricTile
          label="Indirect probe failure"
          Icon={XCircle}
          series={series.indirectProbeFailure}
          tone="danger"
          info={metricInfo.indirectProbeFailure}
        />
        <MetricTile
          label="Indirect probe refuted"
          Icon={Repeat}
          series={series.indirectProbeRefuted}
          tone="neutral"
          info={metricInfo.indirectProbeRefuted}
        />
        <MetricTile
          label="Write quorum failures"
          Icon={AlertTriangle}
          series={series.writeQuorumFailures}
          tone="danger"
          info={metricInfo.writeQuorumFailures}
        />
        <MetricTile
          label="Forward promotions"
          Icon={ArrowUpRightFromCircle}
          series={series.writeForwardPromotion}
          tone="warning"
          info={metricInfo.writeForwardPromotion}
        />
      </Grid>
    </SectionCard>
  );
}

// ---- Repair / Drift -------------------------------------------------

export function RepairCard({
  series,
  data,
}: {
  series: Series;
  data: DistMetrics | undefined;
}) {
  const lastSyncErr = data?.lastAutoSyncError ?? "";

  // Coalesce ratio: of all repair-queue enqueues that COULD have
  // become wire calls, what fraction was collapsed by the
  // coalescer? = coalesced / (coalesced + batched). Operators read
  // this as the amortisation factor of `WithDistReadRepairBatch`.
  // Only meaningful when the batched path is in use — fall back to
  // null when nothing has been routed through the queue.
  const coalesced = data?.readRepairCoalesced ?? 0;
  const batched = data?.readRepairBatched ?? 0;
  const coalesceTotal = coalesced + batched;
  const coalesceRatio =
    coalesceTotal > 0 ? (coalesced / coalesceTotal) * 100 : null;

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
          <p className="text-xs font-semibold tracking-wider uppercase">
            Last auto-sync error
          </p>
          <p className="mt-1 font-mono text-[13px] break-all">{lastSyncErr}</p>
        </div>
      )}
      {coalesceRatio !== null && (
        <div className="mb-4">
          <HeroNumber
            label="Read-repair coalesce ratio"
            value={`${coalesceRatio.toFixed(1)}%`}
            caption={`${coalesced.toLocaleString()} collapsed / ${coalesceTotal.toLocaleString()} enqueued`}
            tone="success"
            info={metricInfo.coalesceRatio}
          />
        </div>
      )}
      <Grid>
        <MetricTile
          label="Read repair"
          Icon={RefreshCw}
          series={series.readRepair}
          tone="success"
          info={metricInfo.readRepair}
        />
        <MetricTile
          label="Read repair (batched)"
          Icon={PackagePlus}
          series={series.readRepairBatched}
          tone="primary"
          info={metricInfo.readRepairBatched}
        />
        <MetricTile
          label="Read repair (coalesced)"
          Icon={Shuffle}
          series={series.readRepairCoalesced}
          tone="success"
          info={metricInfo.readRepairCoalesced}
        />
        <MetricTile
          label="Merkle syncs"
          Icon={Layers}
          series={series.merkleSyncs}
          tone="primary"
          info={metricInfo.merkleSyncs}
        />
        <MetricTile
          label="Merkle keys pulled"
          Icon={ArrowDownToLine}
          series={series.merkleKeysPulled}
          tone="primary"
          info={metricInfo.merkleKeysPulled}
        />
        <MetricTile
          label="Auto-sync loops"
          Icon={Radar}
          series={series.autoSyncLoops}
          tone="neutral"
          info={metricInfo.autoSyncLoops}
        />
        <MetricTile
          label="Tombstones active"
          Icon={Boxes}
          series={series.tombstonesActive}
          tone="warning"
          info={metricInfo.tombstonesActive}
        />
        <MetricTile
          label="Tombstones purged"
          Icon={TrendingDown}
          series={series.tombstonesPurged}
          tone="success"
          info={metricInfo.tombstonesPurged}
        />
        <MetricTile
          label="Version conflicts"
          Icon={AlertTriangle}
          series={series.versionConflicts}
          tone="warning"
          info={metricInfo.versionConflicts}
        />
        <MetricTile
          label="Version tie-breaks"
          Icon={Drama}
          series={series.versionTieBreaks}
          tone="neutral"
          info={metricInfo.versionTieBreaks}
        />
        <MetricTile
          label="Read primary promote"
          Icon={ArrowUpRightFromCircle}
          series={series.readPrimaryPromote}
          tone="neutral"
          info={metricInfo.readPrimaryPromote}
        />
      </Grid>
    </SectionCard>
  );
}

// ---- Membership / Drift --------------------------------------------

export function MembershipCard({
  data,
  series,
}: {
  data: DistMetrics | undefined;
  series: Series;
}) {
  return (
    <SectionCard
      Icon={Users}
      title="Membership"
      description="Live state of the cluster: alive, suspect, dead."
    >
      {data && (
        <ul
          role="list"
          className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          <GaugeTile
            label="Alive"
            value={data.membersAlive}
            tone="success"
            Icon={CheckCircle2}
            info={metricInfo.membersAlive}
          />
          <GaugeTile
            label="Suspect"
            value={data.membersSuspect}
            tone="warning"
            Icon={AlertTriangle}
            info={metricInfo.membersSuspect}
          />
          <GaugeTile
            label="Dead"
            value={data.membersDead}
            tone="danger"
            Icon={XCircle}
            info={metricInfo.membersDead}
          />
          <GaugeTile
            label="Membership version"
            value={data.membershipVersion}
            tone="neutral"
            Icon={Gauge}
            info={metricInfo.membershipVersion}
          />
        </ul>
      )}
      <Grid>
        <MetricTile
          label="Drains"
          Icon={ArrowDown}
          series={series.drains}
          tone="neutral"
          info={metricInfo.drains}
        />
        <MetricTile
          label="Nodes removed"
          Icon={XCircle}
          series={series.nodesRemoved}
          tone="danger"
          info={metricInfo.nodesRemoved}
        />
      </Grid>
    </SectionCard>
  );
}

// ---- Hinted handoff -------------------------------------------------

export function HintedHandoffCard({
  series,
  data,
}: {
  series: Series;
  data: DistMetrics | undefined;
}) {
  const bytesQueued = data?.hintedBytes ?? 0;

  // Retention rate: of every hint that terminated (replayed OR
  // expired), what fraction made it through. Pre-fix operators
  // had no way to see whether transiently-unreachable peers were
  // being patched up via the queue or losing writes; this is the
  // single number that summarises it.
  const replayed = data?.hintedReplayed ?? 0;
  const expired = data?.hintedExpired ?? 0;
  const terminated = replayed + expired;
  const retentionRate = terminated > 0 ? (replayed / terminated) * 100 : null;

  // Migration-hint last age — surfaced as a tile rather than a
  // sparkline because it's a "most recent observation" gauge, not
  // a rate.
  const migrationAgeMs = (data?.migrationHintLastAgeNanos ?? 0) / 1_000_000;

  return (
    <SectionCard
      Icon={BellRing}
      title="Hinted handoff"
      description="Pending writes for offline replicas, replayed on recovery."
    >
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {retentionRate !== null && (
          <HeroNumber
            label="Hint retention rate"
            value={`${retentionRate.toFixed(1)}%`}
            caption={`${replayed.toLocaleString()} replayed / ${terminated.toLocaleString()} terminated`}
            tone={
              retentionRate >= 95
                ? "success"
                : retentionRate >= 80
                  ? "warning"
                  : "danger"
            }
            info={metricInfo.retentionRate}
          />
        )}
        {bytesQueued > 0 && (
          <HeroNumber
            label="Bytes queued"
            value={formatBytes(bytesQueued)}
            caption="Total bytes pending replay"
            tone="warning"
            info={metricInfo.bytesQueued}
          />
        )}
      </div>
      <Grid>
        <MetricTile
          label="Queued"
          Icon={ArrowUp}
          series={series.hintedQueued}
          tone="warning"
          info={metricInfo.hintedQueued}
        />
        <MetricTile
          label="Replayed"
          Icon={CheckCircle2}
          series={series.hintedReplayed}
          tone="success"
          info={metricInfo.hintedReplayed}
        />
        <MetricTile
          label="Expired"
          Icon={TrendingDown}
          series={series.hintedExpired}
          tone="neutral"
          info={metricInfo.hintedExpired}
        />
        <MetricTile
          label="Dropped (per node)"
          Icon={XCircle}
          series={series.hintedDropped}
          tone="danger"
          info={metricInfo.hintedDropped}
        />
        <MetricTile
          label="Dropped (global)"
          Icon={AlertTriangle}
          series={series.hintedGlobalDropped}
          tone="danger"
          info={metricInfo.hintedGlobalDropped}
        />
        <MetricTile
          label="Bytes flowing"
          Icon={TrendingUp}
          series={series.hintedBytes}
          tone="neutral"
          unit=" B/s"
          info={metricInfo.hintedBytes}
        />
        <MetricTile
          label="Migration · queued"
          Icon={Truck}
          series={series.migrationHintQueued}
          tone="warning"
          info={metricInfo.migrationHintQueued}
        />
        <MetricTile
          label="Migration · replayed"
          Icon={CheckCircle2}
          series={series.migrationHintReplayed}
          tone="success"
          info={metricInfo.migrationHintReplayed}
        />
        <MetricTile
          label="Migration · expired"
          Icon={TrendingDown}
          series={series.migrationHintExpired}
          tone="neutral"
          info={metricInfo.migrationHintExpired}
        />
        <MetricTile
          label="Migration · dropped"
          Icon={XCircle}
          series={series.migrationHintDropped}
          tone="danger"
          info={metricInfo.migrationHintDropped}
        />
      </Grid>
      {migrationAgeMs > 0 && (
        <p className="text-muted-foreground mt-3 text-xs">
          <Timer
            aria-hidden
            className="-mt-0.5 mr-1 inline h-3 w-3"
          />
          Last migration-hint queue residency:{" "}
          <span className="text-foreground font-mono tabular-nums">
            {formatDurationMs(migrationAgeMs)}
          </span>
        </p>
      )}
    </SectionCard>
  );
}

// ---- Chaos ----------------------------------------------------------

export function ChaosCard({
  series,
  data,
}: {
  series: Series;
  data: DistMetrics | undefined;
}) {
  // Production clusters should have both counters at zero; only
  // render the card when chaos is actually engaged so the page
  // stays focused for the typical operator. Test/staging
  // environments running fault-injection see the card appear as
  // soon as the first drop or latency injection fires.
  const drops = data?.chaosDrops ?? 0;
  const latencies = data?.chaosLatencies ?? 0;
  if (drops === 0 && latencies === 0) {
    return null;
  }

  return (
    <SectionCard
      Icon={FlaskConical}
      title="Chaos"
      description="Fault-injection signals from the chaos transport wrapper (test/staging only)."
    >
      <Grid>
        <MetricTile
          label="Transport drops"
          Icon={Zap}
          series={series.chaosDrops}
          tone="danger"
          info={metricInfo.chaosDrops}
        />
        <MetricTile
          label="Injected latencies"
          Icon={Timer}
          series={series.chaosLatencies}
          tone="warning"
          info={metricInfo.chaosLatencies}
        />
      </Grid>
    </SectionCard>
  );
}

// ---- Rebalance ------------------------------------------------------

export function RebalanceCard({ series }: { series: Series }) {
  return (
    <SectionCard
      Icon={Network}
      title="Rebalance"
      description="Key migration during membership changes."
    >
      <Grid>
        <MetricTile
          label="Keys rebalanced"
          Icon={Repeat}
          series={series.rebalancedKeys}
          tone="primary"
          info={metricInfo.rebalancedKeys}
        />
        <MetricTile
          label="Batches"
          Icon={Layers}
          series={series.rebalanceBatches}
          tone="neutral"
          info={metricInfo.rebalanceBatches}
        />
        <MetricTile
          label="Primary migrations"
          Icon={ArrowUpRightFromCircle}
          series={series.rebalancedPrimary}
          tone="warning"
          info={metricInfo.rebalancedPrimary}
        />
        <MetricTile
          label="Replica diff"
          Icon={GitMerge}
          series={series.rebalancedReplicaDiff}
          tone="neutral"
          info={metricInfo.rebalancedReplicaDiff}
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
      <Icon
        aria-hidden
        className="h-4 w-4"
      />
    </span>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <ul
      role="list"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
    >
      {Array.isArray(children) ? (
        children.map((c, i) => <li key={i}>{c}</li>)
      ) : (
        <li>{children}</li>
      )}
    </ul>
  );
}

function HeroNumber({
  label,
  value,
  caption,
  tone,
  info,
}: {
  label: string;
  value: string;
  caption: string;
  tone: "success" | "warning" | "danger" | "neutral";
  info?: MetricInfoContent;
}) {
  const tones: Record<typeof tone, string> = {
    success: "text-emerald-500",
    warning: "text-amber-500",
    danger: "text-rose-500",
    neutral: "text-violet-400",
  };
  return (
    <div className="bg-muted/40 ring-border/50 rounded-lg p-3 ring-1">
      <div className="flex items-center gap-1">
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          {label}
        </p>
        {info !== undefined && <MetricInfo content={info} />}
      </div>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tones[tone]}`}>
        {value}
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs">{caption}</p>
    </div>
  );
}

function GaugeTile({
  label,
  value,
  tone,
  Icon,
  info,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "danger" | "neutral";
  Icon: typeof Activity;
  info?: MetricInfoContent;
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
          <div className="flex min-w-0 items-center gap-1">
            <figcaption className="text-muted-foreground truncate text-xs font-medium">
              {label}
            </figcaption>
            {info !== undefined && <MetricInfo content={info} />}
          </div>
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ${tones[tone]}`}
          >
            <Icon
              aria-hidden
              className="h-3.5 w-3.5"
            />
          </span>
        </div>
        <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
          {value.toLocaleString()}
        </p>
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

function formatDurationMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} m`;
}
