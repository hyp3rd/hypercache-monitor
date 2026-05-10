import type { NextRequest } from "next/server";

/**
 * baseFromHost resolves a same-origin base URL against the request's
 * actual `Host` header rather than `req.url` / `req.nextUrl`.
 *
 * Why this exists: in Next.js 16 standalone mode, `NextRequest.url`
 * (and `req.nextUrl`) is constructed from the `HOSTNAME` env var
 * — typically `0.0.0.0` so the listener binds to all interfaces in
 * a docker container. The actual `Host` header the browser sent is
 * preserved on `req.headers.get("host")` but not reflected in
 * `req.url`. So a redirect built with `new URL(path, req.url)`
 * produces `Location: http://0.0.0.0:3000/...`, which the browser
 * either can't follow or follows into a different cookie scope.
 *
 * Resolution order:
 *   1. `X-Forwarded-Host` / `X-Forwarded-Proto` — proxied
 *      deployments (k8s ingress, nginx) terminate TLS at the
 *      proxy and forward the operator-visible host here.
 *   2. `Host` header — direct browser → app, no proxy.
 *   3. `req.nextUrl.host` — the (likely-bad) bind address; only
 *      reached when neither header is set, which doesn't happen
 *      via a real HTTP/1.1 client.
 */
export function baseFromHost(req: NextRequest): URL {
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    req.nextUrl.host;
  const proto =
    req.headers.get("x-forwarded-proto") ??
    req.nextUrl.protocol.replace(":", "");
  return new URL(`${proto}://${host}`);
}
