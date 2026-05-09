import { proxyToCache } from "@/lib/api/proxy";
import type { NextRequest } from "next/server";

/**
 * Proxy for the HyperCache **management HTTP** (port 8081).
 * Read-only routes only — `evict`, `clear`,
 * `trigger-expiration` go through the dedicated
 * `mgmt/control/[op]/route.ts` so admin-scope gating is
 * unmistakable.
 *
 * Even though the upstream cache binary in v2.0 doesn't enforce
 * any auth on the mgmt port, the proxy DOES require a session.
 * That makes the proxy itself the trust boundary; an
 * unauthenticated request can't address the mgmt port through
 * us regardless of the upstream's posture.
 */

interface RouteContext {
  params: Promise<{ clusterId: string; path: string[] }>;
}

async function handle(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { path } = await ctx.params;
  const segments = path.join("/");

  // Hard guard: the dedicated control route handles mutations.
  // If a request reaches this catch-all with a control verb,
  // refuse — keeps the admin-gating logic in one place.
  if (
    segments === "evict" ||
    segments === "trigger-expiration" ||
    segments === "clear"
  ) {
    return new Response(
      JSON.stringify({
        error: "use /mgmt/control/[op] for mutating ops",
        code: "WRONG_ROUTE",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  return proxyToCache(req, { target: "mgmt", path: "/" + segments });
}

export { handle as GET, handle as HEAD };
