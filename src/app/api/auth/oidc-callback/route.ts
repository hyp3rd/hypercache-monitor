import { auth, isOIDCEnabled } from "@/lib/auth/oidc";
import { getSession, type Scope } from "@/lib/auth/session";
import { DEFAULT_CLUSTER_ID, getCluster } from "@/lib/clusters/registry";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Phase C OIDC post-callback handler. Wired as the `callbackUrl`
 * for the auth.js sign-in flow on `/login` — auth.js completes the
 * OAuth dance against the IdP, then redirects the operator here
 * with the iron-session-bridge work to do:
 *
 *   1. Read the IdP-issued access token from the auth.js session
 *      (auth() helper; access_token surfaces on the augmented
 *      session shape via the jwt + session callbacks in oidc.ts).
 *   2. Probe the chosen cluster's `/v1/me` with the access token,
 *      same as the static-bearer login route.
 *   3. Seal `session.sessions[clusterId]` with `source: "oidc"`
 *      so logout knows to also call auth.js's signOut().
 *   4. Redirect the operator to `/topology` (or to a stored
 *      next URL when one is provided in the request).
 *
 * Why two cookies (auth.js + iron-session): auth.js manages the
 * IdP-issued OIDC tokens (refresh, expiry); iron-session stores
 * the per-cluster bindings the proxy reads. Splitting them keeps
 * the proxy unaware of OIDC vs static — every read path sees the
 * same `{ token, identity, scopes, source? }` shape. v2 may
 * collapse them when token-refresh ships.
 *
 * Cluster context survives the IdP roundtrip via the `cluster`
 * query param the login form encodes into the auth.js
 * `callbackUrl` (auth.js validates the URL is same-origin so we
 * don't need to sign it ourselves).
 */

const querySchema = z.object({
  cluster: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, "cluster must match [a-zA-Z0-9_-]+")
    .optional(),
});

const meResponseSchema = z
  .object({
    id: z.string().min(1).max(256),
    scopes: z.array(z.enum(["read", "write", "admin"])).max(8),
  })
  .passthrough();

export async function GET(req: NextRequest): Promise<Response> {
  if (!isOIDCEnabled) {
    return NextResponse.json(
      { error: "OIDC not configured", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  const url = new URL(req.url);
  const queryResult = querySchema.safeParse({
    cluster: url.searchParams.get("cluster") ?? undefined,
  });
  if (!queryResult.success) {
    return NextResponse.json(
      { error: "invalid cluster id", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const clusterId = queryResult.data.cluster ?? DEFAULT_CLUSTER_ID;
  const cluster = getCluster(clusterId);
  if (!cluster) {
    return NextResponse.json(
      { error: `unknown cluster: ${clusterId}`, code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  // Read the auth.js session — the access token lives there per
  // the session callback in oidc.ts. If the operator hit this
  // route without completing the IdP dance (deep-link, stale tab),
  // the session is null and we redirect them to /login.
  const authSession = (await auth()) as { accessToken?: string } | null;
  if (!authSession?.accessToken) {
    return NextResponse.redirect(
      new URL(`/login?cluster=${encodeURIComponent(clusterId)}`, req.url),
    );
  }

  const accessToken = authSession.accessToken;

  // Probe the cluster's /v1/me with the IdP-issued access token.
  // Cache's ServerVerify hook (Phase C) validates signature +
  // claims and returns the resolved identity + scopes. Same
  // shape as the static-bearer probe; the bearer source is the
  // only difference.
  const meUrl = new URL("/v1/me", cluster.apiBaseUrl);
  let probe: Response;
  try {
    probe = await fetch(meUrl, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: `cluster unreachable: ${(err as Error).message}`,
        code: "UPSTREAM_FAILURE",
      },
      { status: 502 },
    );
  }

  if (probe.status === 401) {
    return NextResponse.json(
      { error: "OIDC token rejected by cluster", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }
  if (probe.status === 403) {
    return NextResponse.json(
      {
        error: "OIDC identity has no read scope on this cluster",
        code: "FORBIDDEN",
      },
      { status: 403 },
    );
  }
  if (!probe.ok) {
    return NextResponse.json(
      {
        error: `cluster /v1/me failed: HTTP ${probe.status}`,
        code: "UPSTREAM_FAILURE",
      },
      { status: 502 },
    );
  }

  let payload: unknown;
  try {
    payload = await probe.json();
  } catch (err) {
    return NextResponse.json(
      {
        error: `cluster returned non-JSON: ${(err as Error).message}`,
        code: "UPSTREAM_FAILURE",
      },
      { status: 502 },
    );
  }

  const meParsed = meResponseSchema.safeParse(payload);
  if (!meParsed.success) {
    return NextResponse.json(
      {
        error: "cluster returned malformed /v1/me body",
        code: "UPSTREAM_FAILURE",
      },
      { status: 502 },
    );
  }

  const identity = meParsed.data.id;
  const scopes: Scope[] = meParsed.data.scopes;

  const session = await getSession();
  session.activeClusterId = clusterId;
  session.sessions = {
    ...(session.sessions ?? {}),
    [clusterId]: { token: accessToken, identity, scopes, source: "oidc" },
  };
  await session.save();

  // Land the operator on /topology — the canonical post-login
  // destination. Mirrors the static-bearer flow's redirect.
  return NextResponse.redirect(new URL("/topology", req.url));
}
