import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { proxyToCache } from "@/lib/api/proxy";

/**
 * Admin-gated proxy for the cluster-mutating mgmt HTTP routes:
 *   POST /evict
 *   POST /trigger-expiration
 *   POST /clear
 *
 * Phase A: this surface is **unconditionally 501**. The route
 * exists so the URL is stable from day one (the UI components
 * already reference these paths), but the cache server doesn't
 * yet enforce admin scope on these routes (Phase C ships that
 * upstream). Until then, the UI must NOT light up these
 * actions — a typo'd Read-only token would otherwise be able
 * to clear a production cluster through a vulnerable proxy
 * shape.
 *
 * When Phase C lands (cache enforces ScopeAdmin via
 * WithMgmtAuth), flip this route to use
 * `proxyToCache(req, { target: "mgmt", path, requiredScope: "admin" })`
 * and add the matching shadcn Eviction Controls page.
 */

const ALLOWED_OPS = new Set(["evict", "trigger-expiration", "clear"]);

interface RouteContext {
  params: Promise<{ clusterId: string; op: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { op } = await ctx.params;

  if (!ALLOWED_OPS.has(op)) {
    return NextResponse.json({ error: `unknown control op: ${op}`, code: "BAD_REQUEST" }, { status: 400 });
  }

  // Phase A: 501. See module doc for rationale.
  if (process.env["HYPERCACHE_MONITOR_ENABLE_ADMIN_OPS"] !== "true") {
    return NextResponse.json(
      {
        error:
          "admin operations disabled in this build; cache must enforce ScopeAdmin (Phase C) before this UI surface lights up",
        code: "NOT_IMPLEMENTED",
      },
      { status: 501 },
    );
  }

  // Reached only when an operator has explicitly opted in via
  // env var AND the session has admin scope (proxy enforces it).
  return proxyToCache(req, {
    target: "mgmt",
    path: `/${op}`,
    requiredScope: "admin",
  });
}
