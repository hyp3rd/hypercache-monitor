import type { Scope } from "@/lib/auth/session";
import { activeSession } from "@/lib/auth/session";
import { getCluster } from "@/lib/clusters/registry";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import "server-only";

/**
 * Server-side proxy from the browser to a HyperCache cluster.
 *
 * Why proxy at all (not browser → cache directly):
 *   1. CORS is absent on both cache listeners. Adding
 *      `Access-Control-Allow-Origin: *` plus bearer auth is
 *      the prototypical token-leak shape.
 *   2. Bearer-in-browser is XSS-readable. Only safe shape
 *      for a financial-environment control panel is httpOnly
 *      session cookie + server-side bearer injection.
 *   3. The proxy is where admin-scope gating lives. The cache
 *      server's mgmt HTTP doesn't enforce scopes today — the
 *      proxy 501s admin actions until a session has admin
 *      scope. Defense-in-depth.
 *
 * Every proxied request:
 *   - resolves the operator's iron-session for the target cluster
 *   - rejects 401 if no session
 *   - rejects 403 if `requiredScope` is not held
 *   - performs an Origin-header CSRF check on mutating verbs
 *   - injects `X-Request-Id` for cross-process correlation
 *   - attaches `Authorization: Bearer <token>` to the upstream
 *     request, NEVER exposing the token to the browser
 */

export interface ProxyOptions {
  target: "api" | "mgmt";
  path: string;
  /** Non-empty → enforce session has at least this scope. */
  requiredScope?: Scope;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  // Ours, never forwarded:
  "cookie",
  "host",
]);

export async function proxyToCache(req: NextRequest, opts: ProxyOptions): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();

  // 1. Auth — require a valid session for every proxy hit, even
  //    against the mgmt port which the cache binary itself
  //    accepts anonymously. The proxy is the trust boundary.
  const auth = await activeSession();
  if (!auth) {
    return jsonError(401, "UNAUTHORIZED", "no active cluster session", requestId);
  }

  // 2. Scope enforcement. Used today for admin gating on
  //    /evict, /clear, /trigger-expiration; the cache server
  //    doesn't enforce these scopes itself in this version,
  //    so the proxy is the only line of defense.
  if (opts.requiredScope && !auth.session.scopes.includes(opts.requiredScope)) {
    return jsonError(403, "FORBIDDEN", `requires scope: ${opts.requiredScope}`, requestId);
  }

  // 3. CSRF — defense in depth over SameSite=Strict cookies.
  //
  //    Sec-Fetch-Site is the authoritative signal: browsers set
  //    it on every fetch, it can't be forged from JS, and it
  //    distinguishes "same-origin" / "same-site" / "cross-site"
  //    explicitly. We trust it when present.
  //
  //    For legacy clients without Sec-Fetch-Site, fall back to
  //    comparing the Origin URL's host to the request's Host
  //    header (NOT `req.nextUrl.origin`, which `next dev` derives
  //    from configured hostname rather than the actual request —
  //    Origin: http://127.0.0.1:3000 vs nextUrl.origin:
  //    http://localhost:3000 mismatched the same loopback during
  //    Phase B1 E2E and 403'd legitimate same-origin requests).
  if (MUTATING_METHODS.has(req.method)) {
    const fetchSite = req.headers.get("sec-fetch-site");

    if (fetchSite !== null) {
      if (fetchSite !== "same-origin") {
        return jsonError(
          403,
          "CSRF",
          `cross-origin request rejected (sec-fetch-site=${fetchSite})`,
          requestId,
        );
      }
    } else {
      const origin = req.headers.get("origin");
      const host = req.headers.get("host");
      if (origin === null || host === null) {
        return jsonError(403, "CSRF", "missing origin/host headers", requestId);
      }
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        return jsonError(403, "CSRF", "malformed origin header", requestId);
      }
      if (originHost !== host) {
        return jsonError(403, "CSRF", "origin/host mismatch", requestId);
      }
    }
  }

  // 4. Resolve the target base URL.
  const cluster = getCluster(auth.clusterId);
  if (!cluster) {
    return jsonError(500, "CLUSTER_GONE", "active cluster not in registry", requestId);
  }
  const baseUrl = opts.target === "api" ? cluster.apiBaseUrl : cluster.mgmtBaseUrl;
  const upstreamUrl = new URL(opts.path, baseUrl);
  // Carry through any query string the route handler passed us.
  for (const [k, v] of req.nextUrl.searchParams.entries()) {
    upstreamUrl.searchParams.set(k, v);
  }

  // 5. Forward headers, stripping hop-by-hop + Cookie + Host.
  const fwdHeaders = new Headers();
  for (const [k, v] of req.headers.entries()) {
    if (HOP_BY_HOP_HEADERS.has(k.toLowerCase())) continue;
    fwdHeaders.set(k, v);
  }
  fwdHeaders.set("authorization", `Bearer ${auth.session.token}`);
  fwdHeaders.set("x-request-id", requestId);

  // 6. Forward the body untouched. GET/HEAD have no body.
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: fwdHeaders,
      body,
      // Don't follow redirects automatically — the cache
      // shouldn't be redirecting and a redirect would mask a
      // misconfiguration.
      redirect: "manual",
      // Disable the Next.js fetch cache entirely; this is
      // operator-facing live data, never cacheable.
      cache: "no-store",
    });
  } catch (err) {
    return jsonError(502, "UPSTREAM_FAILURE", `upstream fetch failed: ${(err as Error).message}`, requestId);
  }

  // 7. Pass-through response. Strip hop-by-hop on the way back too,
  //    keep the upstream X-Request-Id (or fall back to ours).
  const respHeaders = new Headers();
  for (const [k, v] of upstream.headers.entries()) {
    if (HOP_BY_HOP_HEADERS.has(k.toLowerCase())) continue;
    respHeaders.set(k, v);
  }
  if (!respHeaders.has("x-request-id")) {
    respHeaders.set("x-request-id", requestId);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

function jsonError(status: number, code: string, message: string, requestId: string): Response {
  return NextResponse.json(
    { error: message, code },
    {
      status,
      headers: { "x-request-id": requestId },
    },
  );
}
