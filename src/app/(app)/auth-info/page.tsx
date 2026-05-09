import { fetchSpec, SpecFetchError, type CacheSpec } from "@/lib/api/spec";
import { activeSession } from "@/lib/auth/session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { IdentityCard } from "./_components/identity-card";
import { SchemeCard } from "./_components/scheme-card";
import { ScopesCard } from "./_components/scopes-card";

export const metadata: Metadata = {
  title: "Auth posture",
  description:
    "Session identity, granted scopes, and the cache's advertised security schemes.",
};

/**
 * Read-only operator-audit surface — Phase B4. Three cards:
 *
 *   - IdentityCard: who the operator is (clusterId + identity)
 *   - ScopesCard: what they can do (granted scopes + a permissions
 *     matrix listing every scope's actions, granted or denied)
 *   - SchemeCard: what the cache requires on the wire, scraped
 *     from /v1/openapi.yaml's `components.securitySchemes`
 *
 * No bearer-token disclosure of any kind — operator confirmed
 * that's the right tradeoff for a financial-environment audit
 * surface (per the B4 design Q&A). The only auth artifact this
 * page shows is the *identity label*, which is the human-readable
 * name the cache assigned the token (e.g. "ops", "ro").
 *
 * Spec fetch is server-side, going directly to the cluster's
 * apiBaseUrl rather than via the proxy: spec endpoint is
 * auth-free server-side, and a server component is already in a
 * trusted execution context. The cache for this fetch is set to
 * 60s revalidation — the spec is effectively static within a
 * deployment.
 */
export default async function AuthInfoPage() {
  const auth = await activeSession();
  if (!auth) redirect("/login");

  let spec: CacheSpec | null = null;
  let specError: string | null = null;
  try {
    spec = await fetchSpec(auth.clusterId);
  } catch (err) {
    specError =
      err instanceof SpecFetchError ? err.message : "spec fetch failed";
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
          Reference
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Auth posture
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
          Session identity, granted scopes, and the cache&apos;s advertised
          security schemes for{" "}
          <span className="text-foreground font-mono font-semibold">
            {auth.clusterId}
          </span>
          . Bearer tokens are never displayed.
        </p>
      </header>

      <IdentityCard
        clusterId={auth.clusterId}
        identity={auth.session.identity}
      />
      <ScopesCard granted={auth.session.scopes} />
      {spec ? (
        <SchemeCard
          schemes={spec.components?.securitySchemes}
          specVersion={spec.info.version}
        />
      ) : (
        <SpecFallback message={specError ?? "unknown error"} />
      )}
    </div>
  );
}

function SpecFallback({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="border-border/50 bg-card/60 rounded-lg border p-4 text-sm backdrop-blur"
    >
      <p className="text-foreground font-semibold">Spec unavailable</p>
      <p className="text-muted-foreground mt-1 text-xs">
        Could not fetch the cache&apos;s OpenAPI spec —{" "}
        <span className="text-destructive font-mono">{message}</span>. The
        Identity and Scopes cards above still reflect your live session; only
        the cache-side security-scheme card is missing.
      </p>
    </div>
  );
}
