import type { NextRequest } from "next/server";
import { proxyToCache } from "@/lib/api/proxy";

/**
 * Proxy for the HyperCache **client API** (port 8080).
 * Mirrors the OpenAPI spec served at GET /v1/openapi.yaml on
 * the upstream binary; every cache route is reachable as
 * `/api/clusters/{clusterId}/api/<rest-of-path>`.
 *
 * Phase A: only GET routes are exercised (topology surface
 * doesn't write). Write scope is verified lazily on first
 * PUT/DELETE — we don't pre-flight-probe write scope at
 * login time to avoid littering the cache with junk keys.
 */

interface RouteContext {
  params: Promise<{ clusterId: string; path: string[] }>;
}

async function handle(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { path } = await ctx.params;
  return proxyToCache(req, {
    target: "api",
    path: "/" + path.join("/"),
  });
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as DELETE,
  handle as HEAD,
  handle as PATCH,
};
