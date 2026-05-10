import { getSession } from "@/lib/auth/session";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Logout. Two shapes:
 *
 *   POST /api/auth/logout
 *     → Destroys the whole iron-session cookie. Wipes every
 *       cluster's bound session in one go. Original Phase A
 *       behavior.
 *
 *   POST /api/auth/logout?cluster=<id>
 *     → Drops just that cluster's session entry. Other clusters
 *       remain bound. If the active cluster matches the dropped
 *       one, the active is reassigned to whichever bound cluster
 *       remains (deterministic: alphabetical first), or the whole
 *       cookie is destroyed when no clusters remain bound.
 *
 * Cookies are HMAC-sealed, so a logout that just rewrites the
 * cookie is sufficient — no server-side blocklist. The
 * per-cluster path is the deliberate counterpart to Phase C1's
 * "Per-cluster logout still out of scope" stopping condition.
 *
 * Why a deterministic reassignment (not "pick last-active"):
 * the session shape doesn't track per-cluster activity history,
 * and the alphabetical-first choice keeps the post-logout state
 * predictable for tests + operators.
 */

const querySchema = z.object({
  cluster: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, "cluster must match [a-zA-Z0-9_-]+")
    .optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    cluster: url.searchParams.get("cluster") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid cluster id in query", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const session = await getSession();

  if (parsed.data.cluster === undefined) {
    session.destroy();
    return NextResponse.json({ ok: true, mode: "all" });
  }

  const targetId = parsed.data.cluster;
  const sessions = { ...(session.sessions ?? {}) };

  // Treat a logout for an unbound cluster as a no-op success
  // rather than a 404 — operators routinely double-click logout
  // buttons + dispatch /api/auth/logout from stale tabs, and
  // returning 404 would mask the (already-correct) end state.
  if (!(targetId in sessions)) {
    return NextResponse.json({
      ok: true,
      mode: "cluster",
      clusterId: targetId,
      removed: false,
    });
  }

  delete sessions[targetId];
  session.sessions = sessions;

  // Reassign activeClusterId when the dropped cluster was the
  // active one. Pick the alphabetically-first remaining bound
  // cluster for deterministic post-logout state. If none remain,
  // destroy the whole cookie — leaving an empty session with a
  // stale activeClusterId would 401 every subsequent proxy call.
  if (session.activeClusterId === targetId) {
    const remaining = Object.keys(sessions).sort();
    const next = remaining[0];

    if (next === undefined) {
      session.destroy();
      return NextResponse.json({
        ok: true,
        mode: "cluster",
        clusterId: targetId,
        removed: true,
        sessionDestroyed: true,
      });
    }

    session.activeClusterId = next;
  }

  await session.save();

  return NextResponse.json({
    ok: true,
    mode: "cluster",
    clusterId: targetId,
    removed: true,
    activeClusterId: session.activeClusterId,
  });
}
