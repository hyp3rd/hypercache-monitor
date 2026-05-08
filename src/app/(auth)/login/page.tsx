import type { Metadata } from "next";
import { BrandMark } from "@/components/brand-mark";
import { listClusters } from "@/lib/clusters/registry";
import { toListItem } from "@/lib/clusters/types";
import { LoginForm } from "./_components/login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Authenticate against a HyperCache cluster",
};

/**
 * Phase C1: the login page is now multi-cluster aware. It server-
 * fetches the cluster registry and passes the list to the form.
 *
 * `?cluster=<id>` query param preselects the dropdown — used when
 * the cluster picker redirects an operator who hasn't logged into
 * a particular cluster yet (`/api/auth/switch-cluster` returns 401
 * + the picker pushes here).
 *
 * Single-cluster deployments (env-fallback path) see exactly one
 * cluster in the list — the form renders without the dropdown,
 * preserving the Phase A / B login UX unchanged.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ cluster?: string | string[] }>;
}) {
  const clusters = listClusters().map(toListItem);
  const params = await searchParams;
  const requestedCluster = typeof params.cluster === "string" ? params.cluster : undefined;
  // If the URL preselects a cluster but it's not in the registry,
  // ignore the param rather than render a confusing pre-broken
  // form. The picker only links here for clusters that exist.
  const preselected =
    requestedCluster !== undefined && clusters.some((c) => c.id === requestedCluster)
      ? requestedCluster
      : (clusters[0]?.id ?? undefined);

  return (
    <main className="grid-backdrop bg-background relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      {/* Soft brand glow behind the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:radial-gradient(80%_60%_at_50%_30%,oklch(0.55_0.22_295/0.18),transparent_60%)]"
      />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark size={56} className="brand-glow" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">HyperCache Monitor</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Operator control panel for distributed cache clusters.
          </p>
        </div>
        <LoginForm clusters={clusters} preselectedClusterId={preselected} />
        <p className="text-muted-foreground mt-6 text-center text-xs">
          Tokens are issued out-of-band by your cluster operator.{" "}
          <span className="font-mono">HYPERCACHE_AUTH_CONFIG</span> defines available identities.
        </p>
      </div>
    </main>
  );
}
