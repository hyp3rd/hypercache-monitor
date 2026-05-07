"use client";

import type { ClusterRing } from "@/lib/api/mgmt";
import { useMemo } from "react";

/**
 * Hand-rolled SVG ring visualization. Each vnode is a `<circle>`
 * with `aria-label` so a screen reader can read out which node
 * owns which slice. Pure SVG (not Recharts) — the ring is a
 * circular layout that doesn't fit any of Recharts' chart shapes
 * and its accessibility is something we control directly.
 *
 * Visual treatment:
 *   - vnode dots are color-coded per node, matching the legend
 *   - active ownership renders as filled circles with a soft
 *     drop shadow (the shadow is the "glow" that hints at
 *     liveness without distracting)
 *   - the center has the cluster's vnode count in big mono
 *     numerals — at-a-glance "size" cue
 *   - radial separator lines every N vnodes give the ring a
 *     clock-face read so the eye can track position around the
 *     wheel
 */

// Distinct violet/teal/amber palette — chosen for dark-mode
// legibility and accessibility (each pair has distinct hue and
// luminance, not just hue, so colorblind operators still
// distinguish nodes).
const PALETTE = [
  "oklch(0.72 0.21 295)", // brand violet
  "oklch(0.78 0.15 195)", // teal
  "oklch(0.82 0.16 80)", // amber
  "oklch(0.7 0.18 152)", // emerald
  "oklch(0.7 0.2 25)", // rose
  "oklch(0.68 0.18 250)", // indigo
  "oklch(0.74 0.16 130)", // chartreuse
  "oklch(0.72 0.18 320)", // fuchsia
];

export function RingSvg({ data }: { data: ClusterRing }) {
  const colors = useMemo(() => {
    const ids = Array.from(new Set(data.vnodes.map((v) => v.ownerId))).sort();
    const map: Record<string, string> = {};
    ids.forEach((id, i) => {
      map[id] = PALETTE[i % PALETTE.length] as string;
    });
    return map;
  }, [data.vnodes]);

  if (data.vnodes.length === 0) {
    return <p className="text-muted-foreground text-sm">No vnodes registered.</p>;
  }

  // Layout: ring with vnodes at evenly-spaced angles. The order
  // matters — it's the actual ring order — so we render in the
  // sequence returned by the cache.
  const size = 320;
  const radius = 130;
  const center = size / 2;
  const step = (2 * Math.PI) / data.vnodes.length;

  return (
    <div className="space-y-5">
      <div className="relative mx-auto" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`Hash ring with ${data.count} vnodes`}
          className="overflow-visible"
        >
          <defs>
            {Object.entries(colors).map(([id, color]) => (
              <radialGradient key={id} id={`vnode-${id}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={color} stopOpacity="1" />
                <stop offset="100%" stopColor={color} stopOpacity="0.6" />
              </radialGradient>
            ))}
          </defs>
          {/* Concentric rings as visual anchor */}
          <circle
            cx={center}
            cy={center}
            r={radius + 6}
            fill="none"
            stroke="var(--border)"
            strokeWidth={1}
            strokeDasharray="2 4"
            opacity={0.4}
          />
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--border)"
            strokeWidth={1}
            opacity={0.7}
          />
          <circle
            cx={center}
            cy={center}
            r={radius - 6}
            fill="none"
            stroke="var(--border)"
            strokeWidth={1}
            strokeDasharray="2 4"
            opacity={0.4}
          />
          {/* Cardinal tick marks every quarter — clock-face read */}
          {[0, 90, 180, 270].map((deg) => {
            const a = (deg - 90) * (Math.PI / 180);
            const x1 = center + (radius - 10) * Math.cos(a);
            const y1 = center + (radius - 10) * Math.sin(a);
            const x2 = center + (radius + 10) * Math.cos(a);
            const y2 = center + (radius + 10) * Math.sin(a);
            return (
              <line
                key={deg}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="var(--muted-foreground)"
                strokeWidth={1.5}
                opacity={0.4}
              />
            );
          })}
          {data.vnodes.map((v, i) => {
            const angle = i * step - Math.PI / 2;
            const x = center + radius * Math.cos(angle);
            const y = center + radius * Math.sin(angle);
            const color = colors[v.ownerId] ?? "var(--muted-foreground)";
            return (
              <g key={`${v.hash}-${i}`}>
                {/* Glow layer */}
                <circle cx={x} cy={y} r={6} fill={color} opacity={0.25} />
                {/* Main vnode dot */}
                <circle
                  cx={x}
                  cy={y}
                  r={3.5}
                  fill={color}
                  aria-label={`vnode ${i + 1} of ${data.vnodes.length} owned by ${v.ownerId}`}
                >
                  <title>{`${v.ownerId} · ${v.hash.slice(0, 12)}…`}</title>
                </circle>
              </g>
            );
          })}
          {/* Center label */}
          <text
            x={center}
            y={center - 4}
            textAnchor="middle"
            className="fill-foreground font-mono"
            style={{ fontSize: "32px", fontWeight: 600, letterSpacing: "-0.02em" }}
          >
            {data.count}
          </text>
          <text
            x={center}
            y={center + 18}
            textAnchor="middle"
            className="fill-muted-foreground"
            style={{ fontSize: "11px", letterSpacing: "0.18em", textTransform: "uppercase" }}
          >
            vnodes
          </text>
        </svg>
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs" aria-label="Ring legend">
        {Object.entries(colors).map(([id, color]) => {
          const owned = data.vnodes.filter((v) => v.ownerId === id).length;
          const pct = ((owned / data.vnodes.length) * 100).toFixed(1);
          return (
            <li
              key={id}
              className="bg-muted/30 flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5"
            >
              <span className="flex items-center gap-2">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="font-mono font-medium">{id}</span>
              </span>
              <span className="text-muted-foreground font-mono tabular-nums">
                {owned} <span className="text-muted-foreground/60">/ {pct}%</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
