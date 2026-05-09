import { activeSession } from "@/lib/auth/session";
import { Eraser, FlameKindling, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ControlAction } from "./_components/control-action";

export const metadata: Metadata = {
  title: "Administration",
  description: "Cluster-mutating control surface (admin scope required).",
};

/**
 * Phase C2 admin surface. Three destructive controls forwarded
 * to the cache's management HTTP port through
 * `/api/clusters/[clusterId]/mgmt/control/[op]`:
 *
 *   - Trigger Eviction: runs the eviction algorithm sweep now
 *     instead of waiting for the next scheduled tick.
 *   - Trigger Expiration: runs the TTL purge now.
 *   - Clear cluster: wipes every key. Irreversible.
 *
 * Server-side, the cache's `WithMgmtControlAuth` (Phase C2) gates
 * these on admin scope. Client-side, the proxy's
 * `requiredScope: "admin"` 403s before reaching fetch. THIS page
 * adds a third gate: a server-rendered scope check that 403s the
 * page itself when the operator's session lacks admin. The hidden
 * sidebar entry (rendered conditionally in `app/(app)/layout.tsx`)
 * is *only* a UX nicety — never a security boundary.
 *
 * Not auto-redirecting on missing admin scope: an operator who
 * lands here from a deep link should see a clear "you need admin"
 * message rather than be silently bounced. The same model as
 * /auth-info, which renders explanatory copy when the spec fetch
 * fails rather than collapsing silently.
 */
export default async function AdminPage() {
  const auth = await activeSession();
  if (!auth) redirect("/login");

  const hasAdmin = auth.session.scopes.includes("admin");
  if (!hasAdmin) {
    return <NotAuthorized clusterId={auth.clusterId} />;
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
          Administration
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Controls</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
          Cluster-mutating operations on{" "}
          <span className="text-foreground font-mono font-semibold">{auth.clusterId}</span>. All three forward
          to the cache&apos;s management HTTP port and require <code>admin</code> scope (the cache enforces it
          server-side; this surface is hidden when your session lacks the grant).
        </p>
      </header>

      <ControlAction
        clusterId={auth.clusterId}
        op="evict"
        title="Trigger Eviction"
        summary="Run the configured eviction algorithm now instead of waiting for the next scheduled sweep. Reversible — keys evicted by policy are reclaimed by capacity, not deleted by the operator."
        icon={<FlameKindling aria-hidden className="h-4 w-4" />}
        tone="warn"
        confirmTitle="Trigger eviction sweep?"
        confirmBody="Runs the eviction algorithm immediately on every node. The sweep evicts keys per the configured policy (LRU / LFU / Clock / etc.); operator-written keys may be reclaimed if they fall below the policy's retention threshold. Returns immediately; the actual sweep is async."
        confirmLabel="Trigger eviction"
        successToast="Eviction sweep triggered."
      />

      <ControlAction
        clusterId={auth.clusterId}
        op="trigger-expiration"
        title="Trigger Expiration"
        summary="Run the TTL purge now. Removes keys that have already expired but haven't been swept yet. Pure cleanup — keys still within their TTL are untouched."
        icon={<Eraser aria-hidden className="h-4 w-4" />}
        tone="warn"
        confirmTitle="Trigger TTL expiration sweep?"
        confirmBody="Walks every key on every node and removes ones whose TTL has elapsed. Keys still within their configured TTL are left in place. Safe to run at any time; equivalent to advancing the next scheduled expiration tick."
        confirmLabel="Trigger expiration"
        successToast="Expiration sweep triggered."
      />

      <ControlAction
        clusterId={auth.clusterId}
        op="clear"
        title="Clear cluster"
        summary="Wipe every key from every node. Irreversible — there is no undo, no time-window, no recovery. Use only when the data is safe to lose."
        icon={<Trash2 aria-hidden className="h-4 w-4" />}
        tone="danger"
        confirmTitle="Clear the entire cluster?"
        confirmBody="This deletes every key on every node. Replicas are NOT preserved — the operation fans out to every owner. There is no recovery: no audit trail of removed values, no time-bounded undo. Type the cluster id to confirm if you are unsure."
        confirmLabel="Clear cluster"
        successToast="Cluster cleared."
      />
    </div>
  );
}

function NotAuthorized({ clusterId }: { clusterId: string }) {
  return (
    <div className="space-y-6">
      <header>
        <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
          Administration
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Controls</h1>
      </header>
      <div role="alert" className="border-destructive/40 bg-destructive/5 rounded-lg border p-4 text-sm">
        <p className="text-foreground font-semibold">Insufficient scope</p>
        <p className="text-muted-foreground mt-1 text-xs">
          The token bound to <span className="text-foreground font-mono">{clusterId}</span> does not carry the{" "}
          <span className="text-foreground font-mono font-semibold">admin</span> scope. Cluster- mutating
          operations (evict, trigger-expiration, clear) require an admin-scoped token configured in{" "}
          <span className="font-mono">HYPERCACHE_AUTH_CONFIG</span>. Ask your cluster operator to issue one,
          or sign in with a different identity.
        </p>
      </div>
    </div>
  );
}
