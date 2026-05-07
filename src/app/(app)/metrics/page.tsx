import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { activeSession } from "@/lib/auth/session";
import { MetricsClient } from "./_components/metrics-client";

export const metadata: Metadata = {
  title: "Metrics",
  description: "Capacity, traffic, reliability, repair and rebalance signals.",
};

export default async function MetricsPage() {
  const auth = await activeSession();
  if (!auth) redirect("/login");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
            Observability
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Metrics</h1>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
            Capacity, traffic, reliability and repair signals for{" "}
            <span className="text-foreground font-mono font-semibold">{auth.clusterId}</span>. Rate sparklines
            show the last 5 minutes; polling drops to 30s while the tab is hidden.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-500 ring-1 ring-emerald-500/20">
          <span aria-hidden className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/60 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live
        </span>
      </header>
      <MetricsClient clusterId={auth.clusterId} />
    </div>
  );
}
