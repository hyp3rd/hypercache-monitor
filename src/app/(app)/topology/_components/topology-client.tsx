"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { clusterMembersSchema, clusterRingSchema, fetchMgmt, heartbeatSchema } from "@/lib/api/mgmt";
import { queryKeys } from "@/lib/query/keys";
import { usePollInterval } from "@/lib/query/poll";
import { useQuery } from "@tanstack/react-query";
import { Activity, CircuitBoard, Network } from "lucide-react";
import { HeartbeatStats } from "./heartbeat-stats";
import { MembersTable } from "./members-table";
import { RingSvg } from "./ring-svg";

/**
 * Three independent queries — members, ring, heartbeat — laid
 * out as a 12-col grid:
 *   - Members + Heartbeat stack on the left (2/3 width)
 *   - Ring viz spans the right (1/3 width), full-height card
 *
 * Each query has its own skeleton + error state so a slow
 * upstream doesn't block the others. The ring polls less
 * aggressively than members since it only changes on
 * membership transitions.
 */
export function TopologyClient({ clusterId }: { clusterId: string }) {
  const interval = usePollInterval({ active: 2000, idle: 30000 });

  const members = useQuery({
    queryKey: queryKeys.members(clusterId),
    queryFn: () => fetchMgmt(clusterId, "cluster/members", clusterMembersSchema),
    refetchInterval: interval,
  });

  const ring = useQuery({
    queryKey: queryKeys.ring(clusterId),
    queryFn: () => fetchMgmt(clusterId, "cluster/ring", clusterRingSchema),
    refetchInterval: interval * 2,
  });

  const heartbeat = useQuery({
    queryKey: queryKeys.heartbeat(clusterId),
    queryFn: () => fetchMgmt(clusterId, "cluster/heartbeat", heartbeatSchema),
    refetchInterval: interval,
  });

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        <Card className="border-border/50 bg-card/60 backdrop-blur">
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <SectionIcon Icon={Network} />
            <div>
              <CardTitle>Members</CardTitle>
              <CardDescription>Live membership snapshot, polled every {interval / 1000}s.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {members.isLoading && <SkeletonRows count={4} />}
            {members.error && <ErrorState message={(members.error as Error).message} />}
            {members.data && <MembersTable data={members.data} />}
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/60 backdrop-blur">
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <SectionIcon Icon={Activity} />
            <div>
              <CardTitle>Heartbeat</CardTitle>
              <CardDescription>SWIM-style probe accounting and recovery counters.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {heartbeat.isLoading && <SkeletonRows count={2} />}
            {heartbeat.error && <ErrorState message={(heartbeat.error as Error).message} />}
            {heartbeat.data && <HeartbeatStats data={heartbeat.data} />}
          </CardContent>
        </Card>
      </div>

      <div>
        <Card className="border-border/50 bg-card/60 h-full backdrop-blur">
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <SectionIcon Icon={CircuitBoard} />
            <div>
              <CardTitle>Hash ring</CardTitle>
              <CardDescription>Vnode distribution across owners.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {ring.isLoading && <Skeleton className="mx-auto h-72 w-72 rounded-full" />}
            {ring.error && <ErrorState message={(ring.error as Error).message} />}
            {ring.data && <RingSvg data={ring.data} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SectionIcon({ Icon }: { Icon: typeof Network }) {
  return (
    <span className="bg-brand-muted text-primary ring-primary/30 flex h-9 w-9 items-center justify-center rounded-md ring-1">
      <Icon aria-hidden className="h-4 w-4" />
    </span>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <p
      className="bg-destructive/10 text-destructive ring-destructive/20 rounded-md px-3 py-2 text-sm ring-1"
      role="alert"
    >
      {message}
    </p>
  );
}
