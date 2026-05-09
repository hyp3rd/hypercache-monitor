"use client";

import {
  mgmtPath,
  clusterMembersSchema,
  heartbeatSchema,
} from "@/lib/api/mgmt";
import { queryKeys } from "@/lib/query/keys";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * SSE consumer for the cache's `GET /cluster/events` endpoint —
 * the live-topology counterpart to the existing 2-second polling
 * loop in `TopologyClient`. The hook:
 *
 *   - Opens an `EventSource` through the cluster-aware proxy
 *     (`/api/clusters/[clusterId]/mgmt/cluster/events`).
 *   - Parses each frame's data with the same zod schemas the
 *     polling fetcher uses (`clusterMembersSchema`, `heartbeatSchema`).
 *   - Writes parsed snapshots into TanStack Query's cache via
 *     `setQueryData`, so every existing render path on /topology
 *     reads from one source of truth regardless of whether the
 *     update came over SSE or polling.
 *   - Tracks connection state and exposes `connected` so the
 *     caller can disable polling while SSE is live (and re-enable
 *     it during reconnect windows).
 *   - Reconnects with exponential backoff on transient errors.
 *   - Closes on tab hidden + reopens on visible (matches the
 *     existing `usePollInterval` shape).
 *
 * Returns `connected` and `lastEventAt` for the caller to surface
 * a 'live' / 'polling' indicator. Polling fallback is the
 * caller's responsibility — this hook only manages the SSE
 * subscription.
 *
 * Cleanup on unmount or `clusterId` change closes the EventSource
 * + the visibility listener; React's effect-deps machinery
 * guarantees the swap when the operator switches clusters.
 */
export interface UseTopologyEventsResult {
  connected: boolean;
  lastEventAt: Date | null;
}

interface UseTopologyEventsOptions {
  /**
   * Disable the hook entirely (no EventSource opened). Used by
   * tests and by the Phase B build-time path where SSE shouldn't
   * be wired. Default: enabled.
   */
  enabled?: boolean;
  /**
   * EventSource constructor seam. Real code uses `window.EventSource`;
   * tests inject a mock that doesn't depend on a real network.
   */
  eventSourceFactory?: (url: string) => EventSource;
}

const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;

export function useTopologyEvents(
  clusterId: string,
  options: UseTopologyEventsOptions = {},
): UseTopologyEventsResult {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);

  // Use a ref for the attempt counter so the cleanup-and-reopen
  // cycle within one effect call doesn't reset the backoff.
  const attemptRef = useRef(0);

  const enabled = options.enabled !== false;
  // Default to the browser's EventSource at call time so SSR
  // doesn't try to evaluate `window.EventSource` (it's undefined
  // server-side). Captured in a ref so the effect doesn't re-fire
  // when the factory identity changes between renders. The
  // "latest-ref-via-useEffect" pattern (separate effect to write
  // the ref) is the React-strict-safe way to keep the value
  // current without touching refs during render.
  const factoryRef = useRef<UseTopologyEventsOptions["eventSourceFactory"]>(
    options.eventSourceFactory,
  );
  useEffect(() => {
    factoryRef.current = options.eventSourceFactory;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (typeof window === "undefined") {
      return; // SSR safety
    }

    let canceled = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const url = mgmtPath(clusterId, "cluster/events");

    const open = () => {
      if (canceled) return;

      const factory = factoryRef.current ?? ((u: string) => new EventSource(u));
      source = factory(url);

      source.addEventListener("open", () => {
        attemptRef.current = 0;
        setConnected(true);
      });

      source.addEventListener("members", (event) => {
        const payload = parseEventData(event, clusterMembersSchema, "members");
        if (payload === null) return;
        queryClient.setQueryData(queryKeys.members(clusterId), payload);
        setLastEventAt(new Date());
      });

      source.addEventListener("heartbeat", (event) => {
        const payload = parseEventData(event, heartbeatSchema, "heartbeat");
        if (payload === null) return;
        queryClient.setQueryData(queryKeys.heartbeat(clusterId), payload);
        setLastEventAt(new Date());
      });

      source.addEventListener("error", () => {
        // The browser's EventSource auto-retries on transient
        // disconnects (uses the server's `retry:` hint). We layer
        // our own backoff on top so a hard 5xx loop doesn't
        // hammer the proxy: close + schedule a delayed reopen.
        setConnected(false);
        if (source !== null) {
          source.close();
          source = null;
        }

        if (canceled) return;
        const delay = RECONNECT_BACKOFF_MS[
          Math.min(attemptRef.current, RECONNECT_BACKOFF_MS.length - 1)
        ] as number;
        attemptRef.current += 1;
        reconnectTimer = setTimeout(open, delay);
      });
    };

    const onVisibility = () => {
      if (document.hidden) {
        setConnected(false);
        if (source !== null) {
          source.close();
          source = null;
        }

        if (reconnectTimer !== null) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      } else if (source === null && reconnectTimer === null) {
        attemptRef.current = 0;
        open();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) {
      open();
    }

    return () => {
      canceled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (source !== null) source.close();
      setConnected(false);
    };
  }, [clusterId, enabled, queryClient]);

  return { connected, lastEventAt };
}

// parseEventData parses one SSE frame's `data` field through the
// supplied zod schema. Returns null on parse failure so the
// caller drops the frame; one bad frame never crashes the page.
function parseEventData<T>(
  event: MessageEvent,
  schema: {
    safeParse: (
      input: unknown,
    ) => { success: true; data: T } | { success: false; error: unknown };
  },
  label: string,
): T | null {
  let raw: unknown;
  try {
    raw = JSON.parse(event.data);
  } catch (err) {
    console.warn(`[topology-events] ${label} frame is not valid JSON:`, err);
    return null;
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    console.warn(
      `[topology-events] ${label} frame failed schema:`,
      parsed.error,
    );
    return null;
  }

  return parsed.data;
}
