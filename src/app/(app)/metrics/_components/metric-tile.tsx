"use client";

import type { LucideIcon } from "lucide-react";
import type { FieldSeries } from "@/lib/metrics/use-metrics-polling";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";

/**
 * One rate-card tile. Lays out:
 *
 *   [icon]  LABEL
 *   123,456                    <- current cumulative value
 *           42.0/s             <- per-second rate (most recent)
 *           [sparkline]        <- 5-min window of rates
 *
 * The tile renders even when the buffer is empty (initial paint
 * before the first poll completes) — sparkline shows a "no data
 * yet" placeholder, rate shows "—". Avoids layout shift on the
 * first arriving sample.
 */

type Tone = "primary" | "success" | "warning" | "danger" | "neutral";

const TONE_STYLES: Record<Tone, { tile: string; spark: string }> = {
  primary: {
    tile: "text-primary bg-primary/10 ring-primary/20",
    spark: "var(--primary)",
  },
  success: {
    tile: "text-emerald-500 bg-emerald-500/10 ring-emerald-500/20",
    spark: "rgb(16 185 129)",
  },
  warning: {
    tile: "text-amber-500 bg-amber-500/10 ring-amber-500/20",
    spark: "rgb(245 158 11)",
  },
  danger: {
    tile: "text-rose-500 bg-rose-500/10 ring-rose-500/20",
    spark: "rgb(244 63 94)",
  },
  neutral: {
    tile: "text-violet-400 bg-violet-500/10 ring-violet-500/20",
    spark: "rgb(167 139 250)",
  },
};

export function MetricTile({
  label,
  Icon,
  series,
  tone = "primary",
  unit = "/s",
}: {
  label: string;
  Icon: LucideIcon;
  series: FieldSeries;
  tone?: Tone;
  unit?: string;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <figure className="border-border/50 bg-card/50 hover:border-border hover:bg-card relative overflow-hidden rounded-lg border p-3 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <figcaption className="text-muted-foreground text-xs font-medium">{label}</figcaption>
        <span className={cn("flex h-7 w-7 items-center justify-center rounded-md ring-1", styles.tile)}>
          <Icon aria-hidden className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className="mt-2 font-mono text-xl font-semibold tabular-nums">{series.current.toLocaleString()}</p>
      <p className="text-muted-foreground mt-0.5 font-mono text-[11px] tabular-nums">
        {series.rate === null ? "—" : `${formatRate(series.rate)}${unit}`}
      </p>
      <div className="mt-2">
        <Sparkline data={series.deltas} color={styles.spark} ariaLabel={`${label} rate over time`} />
      </div>
    </figure>
  );
}

/**
 * Compact rate formatter — operators shouldn't have to read 8
 * digits to learn the cluster is doing 12k/s.
 */
function formatRate(rate: number): string {
  if (rate === 0) return "0";
  if (rate < 0.01) return rate.toFixed(4);
  if (rate < 1) return rate.toFixed(2);
  if (rate < 100) return rate.toFixed(1);
  if (rate < 10_000) return Math.round(rate).toLocaleString();
  if (rate < 1_000_000) return `${(rate / 1000).toFixed(1)}k`;
  return `${(rate / 1_000_000).toFixed(1)}M`;
}
