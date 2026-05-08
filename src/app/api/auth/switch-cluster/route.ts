import { getSession } from "@/lib/auth/session";
import { getCluster } from "@/lib/clusters/registry";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Switch the session's `activeClusterId` to a cluster the operator
 * has already logged into. Phase C1 entry point for the cluster
 * picker — clicking a cluster in the dropdown POSTs `{ clusterId }`
 * here, server flips the active cluster, and `router.refresh()`
 * re-renders every server component against the new context.
 *
 * Why a dedicated route instead of folding it into login: the
 * picker should not require re-typing the token to flip between
 * clusters the operator has already authenticated against. The
 * session shape (`Record<clusterId, ClusterSession>`) was always
 * meant to support this — Phase C1 just lights it up.
 *
 * Response codes:
 *   200 → switched, picker calls `router.refresh()`
 *   400 → unknown cluster id (registry typo)
 *   401 + code=NEED_LOGIN → cluster exists but session has no
 *         entry; client redirects to `/login?cluster=<id>`
 *   400 → invalid body shape (rare; only if a non-picker caller
 *         hits this route directly)
 */

const bodySchema = z.object({
  clusterId: z
    .string()
    .min(1)
    .max(64)
    // Same character set as the loader's id schema — the value
    // is reflected back in URLs/redirects, so reject anything
    // that wouldn't be URL-safe.
    .regex(/^[a-zA-Z0-9_-]+$/, "clusterId must match [a-zA-Z0-9_-]+"),
});

export async function POST(req: NextRequest): Promise<Response> {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "missing or invalid clusterId in request body", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const { clusterId } = parsed.data;

  // Reject unknown cluster ids at the boundary. The picker only
  // links here for clusters that currently exist in the registry,
  // but a stale tab or a manual curl could try to switch to one
  // that's been removed from `clusters.yaml`.
  if (!getCluster(clusterId)) {
    return NextResponse.json(
      { error: `unknown cluster: ${clusterId}`, code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const session = await getSession();
  const existing = session.sessions?.[clusterId];

  // No bound session for this cluster — surface that to the
  // client so it can route to /login?cluster=<id>. Returning
  // 401 (not 403) because the operator simply hasn't proven
  // identity for this cluster yet; it's an authentication gap,
  // not a permission gap.
  if (!existing) {
    return NextResponse.json(
      { error: "no session for cluster; login required", code: "NEED_LOGIN", clusterId },
      { status: 401 },
    );
  }

  session.activeClusterId = clusterId;
  await session.save();

  return NextResponse.json({ ok: true, clusterId });
}
