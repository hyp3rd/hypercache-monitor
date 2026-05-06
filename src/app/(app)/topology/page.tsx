import type { Metadata } from "next";
import { activeSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { TopologyClient } from "./_components/topology-client";

export const metadata: Metadata = {
  title: "Topology",
  description: "Cluster membership, ring distribution, and heartbeat health.",
};

export default async function TopologyPage() {
  const auth = await activeSession();
  if (!auth) redirect("/login");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Cluster</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Topology</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Live membership, ring distribution, and heartbeat health for{" "}
            <span className="font-mono font-semibold text-foreground">{auth.clusterId}</span>. Active polling every 2 seconds —
            paused while the tab is hidden.
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
      <TopologyClient clusterId={auth.clusterId} />
    </div>
  );
}
