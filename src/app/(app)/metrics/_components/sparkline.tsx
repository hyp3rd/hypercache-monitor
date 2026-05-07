"use client";

import type { DeltaPoint } from "@/lib/metrics/ring-buffer";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

/**
 * Compact sparkline for cumulative-counter rate-of-change. Bound
 * to a fixed 32px height so the metric tile's layout stays
 * predictable across browsers / DPIs.
 *
 * Why a bare AreaChart and not the shadcn `<ChartContainer>`:
 * sparklines have no axes, no tooltip, no legend — none of the
 * chrome ChartContainer brings. We just want a tiny line. The
 * shadcn primitives are reserved for full-page charts (Phase B2
 * doesn't ship one, but the primitive is in place for B-future).
 *
 * `null` rates are gaps in the line — Recharts treats them as
 * missing data and skips them, producing a visual discontinuity
 * exactly where a server-side counter reset happened.
 *
 * `initialDimension` is the Recharts 3.x escape hatch for the
 * "width(-1) and height(-1)" console warning: ResponsiveContainer
 * does a first paint before its ResizeObserver fires, and without
 * a starting size the validator complains. The 100×32 sizing
 * matches the wrapper div's `h-8 w-full` (~minimum reasonable
 * sparkline width) so the first frame is the right shape; the
 * observer then snaps to the real container width on layout.
 */
export function Sparkline({
  data,
  color = "var(--primary)",
  ariaLabel,
}: {
  data: DeltaPoint[];
  color?: string;
  ariaLabel: string;
}) {
  if (data.length === 0) {
    return (
      <div
        role="img"
        aria-label={`${ariaLabel} — no data yet`}
        className="text-muted-foreground/40 flex h-8 w-full items-center text-[10px]"
      >
        ···
      </div>
    );
  }

  const id = `spark-${ariaLabel.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return (
    <div role="img" aria-label={ariaLabel} className="h-8 w-full">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 100, height: 32 }}>
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.45} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="rate"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${id})`}
            isAnimationActive={false}
            connectNulls={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
