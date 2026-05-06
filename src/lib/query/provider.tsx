"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * One QueryClient per browser session. Phase A defaults:
 *   - `staleTime: 0` for live data (the proxy is fast,
 *     correctness wins over byte-saved network calls).
 *   - `refetchOnWindowFocus: true` so the dashboard catches up
 *     when the operator tabs back in.
 *   - `retry` skips 4xx (auth/validation) — those re-trying
 *     waste latency and 401s should redirect to /login, not
 *     spin.
 *
 * Polling cadence isn't set here — surfaces use `useLivePoll`
 * to flip `refetchInterval` based on tab visibility.
 */

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 0,
            refetchOnWindowFocus: true,
            retry: (failureCount, error) => {
              const status = (error as { status?: number }).status;
              if (status !== undefined && status >= 400 && status < 500) {
                return false;
              }
              return failureCount < 2;
            },
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
