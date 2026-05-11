import {
  auth as oidcAuth,
  isOIDCEnabled,
  rpInitiatedLogout,
  signOut as oidcSignOut,
} from "@/lib/auth/oidc";
import { getSession, type ClusterSession } from "@/lib/auth/session";
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
    // Phase C OIDC: when ANY bound cluster's session is OIDC-
    // sourced, also call auth.js's signOut to clear its cookie
    // (and best-effort RP-initiated logout against the IdP). The
    // iron-session destroy clears the per-cluster bindings; the
    // auth.js signOut clears the IdP-issued access/refresh
    // tokens. Whole-session logout fires both regardless of
    // which cluster was active — operators expect "sign out"
    // to fully end the session.
    if (anyOIDCSession(session.sessions)) {
      await signOutAuthJsBestEffort();
    }
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

  // Phase C OIDC: if the cluster being dropped was OIDC-sourced
  // and no OTHER OIDC-sourced cluster remains, also sign out of
  // auth.js (clears its cookie + best-effort RP-initiated logout).
  // We compute this BEFORE deleting the entry from sessions so
  // the source check sees the entry being dropped.
  const droppedSession = sessions[targetId];
  const droppedWasOIDC = droppedSession?.source === "oidc";

  delete sessions[targetId];
  session.sessions = sessions;

  if (droppedWasOIDC && !anyOIDCSession(sessions)) {
    // Last OIDC session in the bag is gone — clear auth.js's
    // cookie too. Other (static) clusters may remain; the
    // iron-session cookie keeps those bound.
    await signOutAuthJsBestEffort();
  }

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

/**
 * anyOIDCSession is the single source of truth for "should auth.js
 * signOut run?" decisions. The caller (whole-session vs per-cluster
 * branches) computes this against the appropriate sessions snapshot
 * and passes the decision into signOutAuthJsBestEffort.
 *
 * Returns true iff at least one binding in the bag was sealed via
 * the OIDC flow. A nil/empty bag is false.
 */
function anyOIDCSession(
  sessions: Record<string, ClusterSession> | undefined,
): boolean {
  return (
    sessions !== undefined &&
    Object.values(sessions).some((s) => s.source === "oidc")
  );
}

/**
 * signOutAuthJsBestEffort terminates BOTH layers of the OIDC
 * session when an OIDC-sourced binding is being destroyed:
 *
 *   1. RP-initiated logout against the IdP's `end_session_endpoint`
 *      using the id_token captured at sign-in time. This is what
 *      actually invalidates the IdP-side session — without this
 *      step, clicking "Sign in with Keycloak" again would silently
 *      reuse the same IdP session (SSO behavior), not prompt the
 *      operator. Best-effort: succeeds when the IdP advertises
 *      end_session_endpoint and accepts the token; degrades to
 *      local-only logout otherwise.
 *
 *   2. Auth.js's local signOut() to clear the auth.js cookie that
 *      was carrying the access_token / id_token / refresh_token.
 *
 * Both calls are wrapped in try/catch — a failure on either side
 * (IdP unreachable, auth.js cookie already cleared by another tab,
 * IdP doesn't support RP-initiated logout) must NOT block the
 * iron-session destroy. The user-visible promise is "you're signed
 * out"; the IdP-side state is best-effort.
 *
 * Pass `redirect: false` to auth.js's signOut so it returns a
 * Response we can ignore rather than redirecting the operator
 * mid-flow — the caller controls the response shape.
 */
async function signOutAuthJsBestEffort(): Promise<void> {
  if (!isOIDCEnabled) {
    return;
  }

  // Step 1: RP-initiated logout — read id_token from the auth.js
  // session, hit the IdP's end_session_endpoint. This must run
  // BEFORE auth.js's local signOut, since signOut clears the
  // session cookie auth() needs to read.
  try {
    const session = (await oidcAuth()) as { idToken?: string } | null;
    const idToken = session?.idToken;
    if (typeof idToken === "string" && idToken.length > 0) {
      const ok = await rpInitiatedLogout(idToken);
      if (!ok) {
        console.warn(
          "[logout] RP-initiated logout returned non-2xx; IdP session may persist",
        );
      }
    }
  } catch (err) {
    console.warn("[logout] RP-initiated logout failed (best-effort):", err);
  }

  // Step 2: clear auth.js's local cookie.
  try {
    await oidcSignOut({ redirect: false });
  } catch (err) {
    console.warn("[logout] auth.js signOut failed (best-effort):", err);
  }
}
