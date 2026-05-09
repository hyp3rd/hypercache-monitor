import { proxyToCache } from "@/lib/api/proxy";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Admin-gated proxy for the cluster-mutating mgmt HTTP routes:
 *   POST /evict
 *   POST /trigger-expiration
 *   POST /clear
 *
 * Phase C2: this surface is now LIVE. Previous Phase A behavior
 * was an unconditional 501 because the cache server didn't enforce
 * admin scope on the upstream mgmt port — a typo'd Read-only token
 * would otherwise have been able to clear a production cluster
 * through a vulnerable proxy shape.
 *
 * What changed:
 *
 *   1. Cache mgmt port (`management_http.go`) now exposes
 *      `WithMgmtControlAuth`, wired in the binary's `main.go` to
 *      `httpauth.Policy.Verify(c, ScopeAdmin)`. Server-side
 *      enforcement is real.
 *   2. Monitor's login flow (Phase C2.1) seals the operator's
 *      REAL scopes from `GET /v1/me` — no more optimistic three-
 *      scope grants. The `requiredScope: "admin"` check in
 *      `proxyToCache` 403s before the request leaves the monitor.
 *   3. `HYPERCACHE_MONITOR_ENABLE_ADMIN_OPS` env gate has been
 *      retired. It was a defense-in-depth belt while the cache
 *      side was unenforced; with both ends checking admin scope
 *      it's belt-and-suspenders we don't need.
 *
 * Forward-compat: a pre-Phase-C2 cache binary returns 401/403/200
 * (no admin enforcement at all), which the proxy still funnels
 * through the requiredScope check on the monitor side. So a
 * mismatched-version cache → admin operator pair still works
 * safely; only the deeper defense layer is missing.
 */

const ALLOWED_OPS = new Set(["evict", "trigger-expiration", "clear"]);

interface RouteContext {
  params: Promise<{ clusterId: string; op: string }>;
}

export async function POST(
  req: NextRequest,
  ctx: RouteContext,
): Promise<Response> {
  const { op } = await ctx.params;

  if (!ALLOWED_OPS.has(op)) {
    return NextResponse.json(
      { error: `unknown control op: ${op}`, code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  return proxyToCache(req, {
    target: "mgmt",
    path: `/${op}`,
    requiredScope: "admin",
  });
}
