"use client";

import { useEffect, useState } from "react";

/**
 * usePollInterval returns the number of ms TanStack Query should
 * wait between re-fetches based on tab visibility. The hook flips
 * the interval at the moment the operator switches away — the
 * cluster is no longer being watched, so 30s is plenty.
 *
 * Pass the result as `refetchInterval` on `useQuery`:
 *
 *     refetchInterval: usePollInterval({ active: 2000, idle: 30000 })
 *
 * The 2s active default matches the cache's heartbeat cadence
 * (defaultHeartbeat = 1s) so transitions are caught within one
 * poll. Higher and the UI lags membership changes; lower and
 * we're hammering the proxy for nothing.
 */
export function usePollInterval(opts: {
  active: number;
  idle: number;
}): number {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const handler = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handler);
    handler();
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  return visible ? opts.active : opts.idle;
}
