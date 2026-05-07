"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useMetricsPolling } from "@/lib/metrics/use-metrics-polling";
import {
  CapacityCard,
  HintedHandoffCard,
  MembershipCard,
  RebalanceCard,
  ReliabilityCard,
  RepairCard,
  TrafficCard,
} from "./section-cards";
import { StatsTable } from "./stats-table";

/**
 * Orchestrator for the `/metrics` page. Single hook drives
 * everything: three TanStack Query subscriptions + per-field
 * ring buffers + visibility-aware polling.
 *
 * Each section card is independent — a slow/failed
 * `/dist/metrics` doesn't block the static `/config` cells
 * from rendering, which matches the topology page's
 * card-isolation contract.
 */
export function MetricsClient({ clusterId }: { clusterId: string }) {
  const { config, stats, distMetrics, series } = useMetricsPolling(clusterId);

  return (
    <div className="space-y-5">
      {config.error && <ErrorBanner section="Capacity" message={(config.error as Error).message} />}
      {distMetrics.error && (
        <ErrorBanner section="Distributed metrics" message={(distMetrics.error as Error).message} />
      )}
      {stats.error && <ErrorBanner section="Per-name stats" message={(stats.error as Error).message} />}

      {config.isLoading ? <CardSkeleton /> : <CapacityCard config={config.data} />}
      {distMetrics.isLoading ? (
        <CardSkeleton tall />
      ) : (
        <>
          <TrafficCard series={series} />
          <ReliabilityCard series={series} data={distMetrics.data} />
          <RepairCard series={series} data={distMetrics.data} />
          <MembershipCard data={distMetrics.data} series={series} />
          <HintedHandoffCard series={series} data={distMetrics.data} />
          <RebalanceCard series={series} />
        </>
      )}
      {stats.isLoading ? <CardSkeleton /> : <StatsTable stats={stats.data} />}
    </div>
  );
}

function CardSkeleton({ tall }: { tall?: boolean }) {
  return (
    <div className="border-border/50 bg-card/60 rounded-xl border p-4">
      <Skeleton className="mb-2 h-5 w-40" />
      <Skeleton className="mb-4 h-3 w-64" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: tall ? 8 : 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    </div>
  );
}

function ErrorBanner({ section, message }: { section: string; message: string }) {
  return (
    <div
      role="alert"
      className="bg-destructive/10 text-destructive ring-destructive/20 rounded-md px-3 py-2 text-sm ring-1"
    >
      <span className="font-semibold">{section}:</span> {message}
    </div>
  );
}
