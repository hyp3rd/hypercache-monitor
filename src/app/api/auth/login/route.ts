import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { DEFAULT_CLUSTER_ID, getCluster } from "@/lib/clusters/registry";
import { getSession, type Scope } from "@/lib/auth/session";

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

  const cluster = getCluster(DEFAULT_CLUSTER_ID);
  if (!cluster) {
    return NextResponse.json(
      { error: "no cluster registered", code: "INTERNAL" },
      { status: 500 },
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
    return NextResponse.json(
      { error: "invalid token", code: "UNAUTHORIZED" },
      { status: 401 },
    );
  }
  if (authProbe.status === 403) {
    return NextResponse.json(
      { error: "token has no Read scope", code: "FORBIDDEN" },
      { status: 403 },
    );
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

  const session = await getSession();
  session.activeClusterId = DEFAULT_CLUSTER_ID;
  session.sessions = {
    ...(session.sessions ?? {}),
    [DEFAULT_CLUSTER_ID]: {
      token: parsed.data.token,
      identity: "default",
      scopes,
    },
  };
  await session.save();

  return NextResponse.json({ ok: true, identity: "default", scopes });
}
