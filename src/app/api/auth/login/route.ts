import { getSession, type Scope } from "@/lib/auth/session";
import { DEFAULT_CLUSTER_ID, getCluster } from "@/lib/clusters/registry";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Login route. POSTs from the client form arrive here with
 * `{ token: string }`. We:
 *
 *   1. Probe the upstream cluster's `/v1/openapi.yaml`
 *      (auth-free) to confirm the cache is reachable.
 *   2. Probe a Read-scope endpoint with the supplied bearer to
 *      confirm the token is valid AND that the operator has at
 *      least Read scope. Used `/v1/owners/__probe__` because it
 *      doesn't depend on a key existing — the cache returns
 *      200 with an owner list regardless.
 *   3. Seal the session cookie with `{ token, identity, scopes }`.
 *      Identity defaults to "default" (Phase A single-cluster
 *      env-driven shape); Phase C reads identity from the cache's
 *      own /v1/me-style endpoint when one exists.
 *
 * Write/Admin scopes are NOT pre-flight-probed — doing so would
 * litter the cache with junk keys. They're verified lazily on
 * first PUT/DELETE/control attempt (the proxy's requiredScope
 * check 403s when missing).
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

export async function POST(req: NextRequest): Promise<Response> {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "missing or invalid token in request body", code: "BAD_REQUEST" },
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

  // Probe 1: upstream reachability (no auth required).
  const reachableUrl = new URL("/v1/openapi.yaml", cluster.apiBaseUrl);
  let probe: Response;
  try {
    probe = await fetch(reachableUrl, { method: "GET", cache: "no-store" });
  } catch (err) {
    return NextResponse.json(
      { error: `cluster unreachable: ${(err as Error).message}`, code: "UPSTREAM_FAILURE" },
      { status: 502 },
    );
  }
  if (!probe.ok) {
    return NextResponse.json(
      { error: `cluster reachability probe failed: HTTP ${probe.status}`, code: "UPSTREAM_FAILURE" },
      { status: 502 },
    );
  }

  // Probe 2: token validity + at least Read scope.
  const ownersUrl = new URL("/v1/owners/__probe__", cluster.apiBaseUrl);
  let authProbe: Response;
  try {
    authProbe = await fetch(ownersUrl, {
      method: "GET",
      headers: { authorization: `Bearer ${parsed.data.token}` },
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      { error: `auth probe failed: ${(err as Error).message}`, code: "UPSTREAM_FAILURE" },
      { status: 502 },
    );
  }
  if (authProbe.status === 401) {
    return NextResponse.json({ error: "invalid token", code: "UNAUTHORIZED" }, { status: 401 });
  }
  if (authProbe.status === 403) {
    return NextResponse.json({ error: "token has no Read scope", code: "FORBIDDEN" }, { status: 403 });
  }
  if (!authProbe.ok) {
    return NextResponse.json(
      { error: `auth probe failed: HTTP ${authProbe.status}`, code: "UPSTREAM_FAILURE" },
      { status: 502 },
    );
  }

  // Phase A doesn't have an identity endpoint to introspect.
  // We seal "default" identity with all three scopes optimistically;
  // write/admin gets verified lazily by the proxy when the action
  // is attempted. Phase C swaps this for a real /v1/me probe.
  const scopes: Scope[] = ["read", "write", "admin"];

  // Identity defaults to the cluster id pending a real /v1/me
  // endpoint on the cache (Phase C2). Multi-cluster operators
  // get a per-cluster identity label that differentiates entries
  // in the picker without us inventing more.
  const identity = clusterId;

  const session = await getSession();
  session.activeClusterId = clusterId;
  session.sessions = {
    ...(session.sessions ?? {}),
    [clusterId]: {
      token: parsed.data.token,
      identity,
      scopes,
    },
  };
  await session.save();

  return NextResponse.json({ ok: true, clusterId, identity, scopes });
}
