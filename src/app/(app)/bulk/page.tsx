import { activeSession } from "@/lib/auth/session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BulkClient } from "./_components/bulk-client";

export const metadata: Metadata = {
  title: "Bulk operations",
  description: "Multi-key fetch, batched CSV import, bulk delete with two-step confirm.",
};

export default async function BulkPage() {
  const auth = await activeSession();
  if (!auth) redirect("/login");

  return (
    <div className="space-y-6">
      <header>
        <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">Cluster</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Bulk operations</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
          Multi-key fetch, batched CSV import, and bulk delete for{" "}
          <span className="text-foreground font-mono font-semibold">{auth.clusterId}</span>. Requests are
          chunked at 1,000 items each; per-item failures don&apos;t halt the batch.
        </p>
      </header>
      <BulkClient clusterId={auth.clusterId} />
    </div>
  );
}
