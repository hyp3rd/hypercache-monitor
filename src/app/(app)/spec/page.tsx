import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { activeSession } from "@/lib/auth/session";
import { fetchSpecRaw, filterToSafeMethods } from "@/lib/api/spec-raw";
import { SpecViewer } from "./_components/spec-viewer";

export const metadata: Metadata = {
  title: "API spec",
  description: "Live OpenAPI 3.x reference for the cache cluster, read-only Try-It-Out.",
};

/**
 * Phase B5 — Live Spec Viewer. Server-fetches the cache's
 * OpenAPI YAML, drops write-method operations from the path
 * tree, then hands the filtered document to Scalar's React
 * renderer (lazy-loaded client-side).
 *
 * Why filter out POST/PUT/PATCH/DELETE here rather than relying
 * on Scalar's `hideTestRequestButton`: that config is global
 * (all-methods-on / all-methods-off). Filtering on the spec
 * itself gives us the per-method behavior we want (read methods
 * stay invokable, write methods don't appear at all). Operators
 * who need to mutate the cache use Bulk or Single-Key Inspector,
 * both of which already gate destructive ops behind explicit
 * confirms.
 *
 * Spec-fetch failure is non-fatal — the page renders a fallback
 * card pointing at the raw spec endpoint, mirroring the
 * /auth-info graceful-degradation pattern.
 */
export default async function SpecPage() {
  const auth = await activeSession();
  if (!auth) redirect("/login");

  let spec: Record<string, unknown> | null = null;
  let error: string | null = null;
  try {
    const raw = await fetchSpecRaw(auth.clusterId);
    spec = filterToSafeMethods(raw);
  } catch (e) {
    error = e instanceof Error ? e.message : "spec fetch failed";
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">Reference</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">API spec</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
          Live OpenAPI reference for{" "}
          <span className="text-foreground font-mono font-semibold">{auth.clusterId}</span>. Read-only methods
          (GET, HEAD) support interactive probing here; writes are documented and invokable from{" "}
          <span className="text-foreground font-medium">Single-Key Inspector</span> or{" "}
          <span className="text-foreground font-medium">Bulk operations</span>, where each destructive op is
          gated by an explicit confirmation.
        </p>
      </header>

      {spec ? <SpecViewer spec={spec} /> : <SpecFallback message={error ?? "unknown error"} />}
    </div>
  );
}

function SpecFallback({ message }: { message: string }) {
  return (
    <div role="alert" className="border-border/50 bg-card/60 rounded-lg border p-4 text-sm backdrop-blur">
      <p className="text-foreground font-semibold">Spec unavailable</p>
      <p className="text-muted-foreground mt-1 text-xs">
        Could not fetch the cache&apos;s OpenAPI spec —{" "}
        <span className="text-destructive font-mono">{message}</span>. The cache exposes the raw spec at{" "}
        <span className="text-foreground font-mono">/v1/openapi.yaml</span> if you need to inspect it
        directly.
      </p>
    </div>
  );
}
