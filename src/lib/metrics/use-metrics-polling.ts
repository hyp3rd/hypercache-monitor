"use client";

import {
  fetchConfig,
  fetchDistMetrics,
  fetchStats,
  type DistMetrics,
} from "@/lib/api/metrics";
import { queryKeys } from "@/lib/query/keys";
import { usePollInterval } from "@/lib/query/poll";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { RingBuffer, type DeltaPoint } from "./ring-buffer";

/**
 * The single hook the `/metrics` page uses to drive the entire
 * dashboard. Three concerns:
 *
 *   1. Polling — three TanStack Query subscriptions
 *      (`/config`, `/stats`, `/dist/metrics`) on the operator's
 *      visibility-aware cadence (5s active / 30s idle).
 *
 *   2. Ring buffers — every cumulative counter in `TRACKED_FIELDS`
 *      gets a per-field FIFO of the last 60 samples (5 min @ 5s).
 *      Buffers live in a per-component external store so the
 *      mutation path (push samples) is decoupled from React's
 *      render cycle.
 *
 *   3. Derived series — `useSyncExternalStore` exposes the
 *      `Record<TrackedField, FieldSeries>` snapshot to the UI;
 *      pushes inside the effect notify subscribers and React
 *      schedules a re-render.
 *
 * Why `useSyncExternalStore` and not a plain `useState`+`setState`
 * inside the effect: React 19's `react-hooks/set-state-in-effect`
 * rule flags "syncing external state via setState in an effect"
 * as a code smell — the blessed alternative is a real external
 * store. This is the smallest store that satisfies the rule
 * without a heavyweight state library.
 *
 * Buffer state is intentionally tab-local: refresh resets the
 * chart. Per the B2 design Q&A — historical metrics live in
 * Prometheus/Grafana, not the control panel.
 */

const RING_CAPACITY = 60;
const POLL_ACTIVE_MS = 5_000;
const POLL_IDLE_MS = 30_000;

/**
 * Cumulative counters whose rate-of-change matters. Listed
 * explicitly so a typo is a compile-time error (the
 * `satisfies (keyof DistMetrics)[]` clause enforces it).
 *
 * Non-counter fields — `lastAutoSyncError` (string),
 * `lastAutoSyncNanos` (gauge), `membershipVersion`,
 * `members{Alive,Suspect,Dead}` (gauges) — are read directly
 * from `distMetrics.data` rather than going through a buffer.
 */
export const TRACKED_FIELDS = [
  // traffic
  "forwardGet",
  "forwardSet",
  "forwardRemove",
  "replicaFanoutSet",
  "replicaFanoutRemove",
  "replicaGetMiss",
  // reliability
  "readRepair",
  "readRepairBatched",
  "readRepairCoalesced",
  "heartbeatSuccess",
  "heartbeatFailure",
  "indirectProbeSuccess",
  "indirectProbeFailure",
  "indirectProbeRefuted",
  "writeAcks",
  "writeAttempts",
  "writeQuorumFailures",
  "writeForwardPromotion",
  // membership transitions (cumulative — gauges live separately)
  "drains",
  "nodesRemoved",
  "versionConflicts",
  "versionTieBreaks",
  "readPrimaryPromote",
  // hinted handoff
  "hintedQueued",
  "hintedReplayed",
  "hintedExpired",
  "hintedDropped",
  "hintedGlobalDropped",
  "hintedBytes",
  // migration-hint subset (rebalance-source hints)
  "migrationHintQueued",
  "migrationHintReplayed",
  "migrationHintExpired",
  "migrationHintDropped",
  // merkle / auto-sync / tombstones
  "merkleSyncs",
  "merkleKeysPulled",
  "autoSyncLoops",
  "tombstonesActive",
  "tombstonesPurged",
  // rebalance
  "rebalancedKeys",
  "rebalanceBatches",
  "rebalancedPrimary",
  "rebalancedReplicaDiff",
  // chaos (test/staging only; zero in prod)
  "chaosDrops",
  "chaosLatencies",
] as const satisfies readonly (keyof DistMetrics)[];

export type TrackedField = (typeof TRACKED_FIELDS)[number];

export interface FieldSeries {
  /** Latest cumulative value from the most recent fetch. */
  current: number;
  /** Per-second rate over the most recent interval, or null if unavailable. */
  rate: number | null;
  /** Time series of per-second rates over the buffer's window. */
  deltas: DeltaPoint[];
}

interface BufferStore {
  push: (data: DistMetrics, t: number) => void;
  subscribe: (cb: () => void) => () => void;
  getSnapshot: () => Record<TrackedField, FieldSeries>;
}

function createBufferStore(): BufferStore {
  const buffers = new Map(
    TRACKED_FIELDS.map((f) => [f, new RingBuffer(RING_CAPACITY)] as const),
  );
  const listeners = new Set<() => void>();
  let snapshot = emptySeriesRecord();

  return {
    push(data, t) {
      let pushed = false;
      for (const field of TRACKED_FIELDS) {
        const buf = buffers.get(field);
        if (buf === undefined) continue;
        if (buf.push({ t, v: data[field] as number })) pushed = true;
      }
      if (!pushed) return;
      const next = {} as Record<TrackedField, FieldSeries>;
      for (const field of TRACKED_FIELDS) {
        const buf = buffers.get(field);
        next[field] = {
          current: data[field] as number,
          rate: buf?.latestRate() ?? null,
          deltas: buf?.deltas() ?? [],
        };
      }
      snapshot = next;
      for (const cb of listeners) cb();
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    getSnapshot() {
      return snapshot;
    },
  };
}

function emptySeriesRecord(): Record<TrackedField, FieldSeries> {
  const empty: FieldSeries = { current: 0, rate: null, deltas: [] };
  const out = {} as Record<TrackedField, FieldSeries>;
  for (const f of TRACKED_FIELDS) out[f] = empty;
  return out;
}

export function useMetricsPolling(clusterId: string) {
  const interval = usePollInterval({
    active: POLL_ACTIVE_MS,
    idle: POLL_IDLE_MS,
  });

  const config = useQuery({
    queryKey: queryKeys.config(clusterId),
    queryFn: () => fetchConfig(clusterId),
    refetchInterval: interval,
  });

  const stats = useQuery({
    queryKey: queryKeys.stats(clusterId),
    queryFn: () => fetchStats(clusterId),
    refetchInterval: interval,
  });

  const distMetrics = useQuery({
    queryKey: queryKeys.distMetrics(clusterId),
    queryFn: () => fetchDistMetrics(clusterId),
    refetchInterval: interval,
  });

  // Lazy `useState` initializer — the store is created exactly
  // once per component mount and the reference is stable across
  // re-renders. The empty destructure (no setter) is intentional;
  // we never replace the store, only mutate its internals.
  const [store] = useState(createBufferStore);

  useEffect(() => {
    if (!distMetrics.data || !distMetrics.dataUpdatedAt) return;
    store.push(distMetrics.data, distMetrics.dataUpdatedAt);
  }, [distMetrics.data, distMetrics.dataUpdatedAt, store]);

  const series = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  return { config, stats, distMetrics, series, interval };
}
