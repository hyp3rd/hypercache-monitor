import { getSession, type Scope } from "@/lib/auth/session";
import { DEFAULT_CLUSTER_ID, getCluster } from "@/lib/clusters/registry";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Login route. POSTs from the client form arrive here with
 * `{ token: string, clusterId?: string }`. We:
 *
 *   1. Probe the upstream cluster's `GET /v1/me` with the supplied
 *      bearer. A 200 proves both reachability AND that the token is
 *      valid for the read scope (`/v1/me` is read-protected).
 *   2. Decode the response into the operator's real identity + the
 *      actual scopes the cache granted them.
 *   3. Seal the session cookie with `{ token, identity, scopes }`
 *      under the chosen `clusterId`. `activeClusterId` is set to
 *      that cluster.
 *
 * Phase C2: the previous implementation made two probes
 * (`/v1/openapi.yaml` for reachability, `/v1/owners/__probe__` for
 * read scope) and sealed an optimistic `["read","write","admin"]`
 * scope set with `identity = clusterId`. That meant the proxy's
 * scope check was accidentally permissive (every session believed
 * it had every scope) and write/admin failures only surfaced lazily
 * as 403s from the cache. `/v1/me` collapses both concerns: one
 * probe, real grants, no optimism.
 *
 * Forward-compat: `/v1/me`'s zod schema uses `.passthrough()` so
 * future cache versions can add fields without breaking older
 * monitors.
 */

const bodySchema = z.object({
  token: z.string().min(1).max(4096),
  // Phase C1: optional clusterId selects which cluster the token
  // is bound to. Defaults to DEFAULT_CLUSTER_ID for back-compat
  // with the Phase A / B single-cluster login form (token-only
  // POST body). Cluster ID character set matches the loader's
  // schema so we reject obvious typos at the boundary.
  clusterId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, "clusterId must match [a-zA-Z0-9_-]+")
    .optional(),
});

// Phase C2: schema for `GET /v1/me` response. Mirrors
// `IdentityResponse` in the cache's openapi.yaml. `.passthrough()`
// keeps unknown future fields (e.g. a `via: "bearer" | "mtls"`
// addition) from breaking older monitors.
const meResponseSchema = z
  .object({
    id: z.string().min(1).max(256),
    scopes: z.array(z.enum(["read", "write", "admin"])).max(8),
  })
  .passthrough();

export async function POST(req: NextRequest): Promise<Response> {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "missing or invalid token in request body",
        code: "BAD_REQUEST",
      },
      { status: 400 },
    );
  }

  const clusterId = parsed.data.clusterId ?? DEFAULT_CLUSTER_ID;
  const cluster = getCluster(clusterId);
  if (!cluster) {
    return NextResponse.json(
      { error: `unknown cluster: ${clusterId}`, code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const meUrl = new URL("/v1/me", cluster.apiBaseUrl);
  let probe: Response;
  try {
    probe = await fetch(meUrl, {
      method: "GET",
      headers: { authorization: `Bearer ${parsed.data.token}` },
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
      { error: "invalid token", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }
  if (probe.status === 403) {
    return NextResponse.json(
      { error: "token has no read scope", code: "FORBIDDEN" },
      { status: 403 },
    );
  }
  if (probe.status === 404) {
    // Cache is reachable but doesn't expose /v1/me. Operator is
    // running a pre-Phase-C2 cache binary against a Phase-C2
    // monitor; surface the version skew clearly so the fix
    // (upgrade the cache, or downgrade the monitor) is obvious.
    return NextResponse.json(
      {
        error:
          "cluster does not expose GET /v1/me; cache server too old for Phase C2 monitor",
        code: "UPSTREAM_FAILURE",
      },
      { status: 502 },
    );
  }
  if (!probe.ok) {
    return NextResponse.json(
      {
        error: `auth probe failed: HTTP ${probe.status}`,
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
        error: `auth probe returned non-JSON body: ${(err as Error).message}`,
        code: "UPSTREAM_FAILURE",
      },
      { status: 502 },
    );
  }

  const meParsed = meResponseSchema.safeParse(payload);
  if (!meParsed.success) {
    return NextResponse.json(
      { error: "auth probe returned malformed body", code: "UPSTREAM_FAILURE" },
      { status: 502 },
    );
  }

  // Phase C2: seal the REAL identity + scopes the cache reports —
  // no more optimistic three-scope grant. The proxy's
  // `auth.session.scopes.includes(opts.requiredScope)` check
  // (src/lib/api/proxy.ts) becomes correct instead of accidentally
  // permissive. Lazy 403s from the cache on write/admin attempts
  // continue to work as defense-in-depth.
  const identity = meParsed.data.id;
  const scopes: Scope[] = meParsed.data.scopes;

  const session = await getSession();
  session.activeClusterId = clusterId;
  session.sessions = {
    ...(session.sessions ?? {}),
    [clusterId]: { token: parsed.data.token, identity, scopes },
  };
  await session.save();

  return NextResponse.json({ ok: true, clusterId, identity, scopes });
}
