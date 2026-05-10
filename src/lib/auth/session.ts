import { serverEnv } from "@/env/server";
import type { SessionOptions } from "iron-session";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import "server-only";

/**
 * iron-session sealed cookie carrying the operator's resolved
 * cache-API session(s). Multi-cluster ready: the same cookie
 * stores credentials for every cluster the operator has logged
 * into, keyed by clusterId. Phase A only ever populates the
 * "default" entry.
 *
 * Why iron-session and not auth.js: zero infrastructure (no DB,
 * no session store), the cookie is signed + encrypted with the
 * IRON_SESSION_SECRET, and auth.js OIDC can land in Phase C as
 * a single-file rewrite of THIS module without touching anything
 * downstream.
 *
 * What's in the cookie:
 *   - activeClusterId: which cluster the UI is currently showing
 *   - sessions[id].token: the bearer token forwarded to the cache
 *   - sessions[id].identity: human-readable label (Identity.ID
 *     from pkg/httpauth/policy.go)
 *   - sessions[id].scopes: the scopes the token carries; used to
 *     gate admin actions in the proxy
 *
 * What's NOT in the cookie:
 *   - The cache base URL (server reads from registry by clusterId)
 *   - Any refresh-token plumbing (tokens are operator-issued and
 *     don't rotate inside a session; rotation is a Phase C concern)
 */

export type Scope = "read" | "write" | "admin";

/**
 * SessionSource tags the origin of the bearer in
 * `ClusterSession.token`:
 *
 *   - `"static"`: operator pasted a token on the login form
 *     (Phase A/B/C1 flow). Existing sessions sealed before
 *     Phase C OIDC have no `source` field at all; logout
 *     defaults to "static" so they keep behaving identically.
 *   - `"oidc"`: token is an IdP-issued access token. Logout
 *     also signs the operator out of auth.js (clears its
 *     cookie, optionally pings the IdP's end_session_endpoint).
 *
 * Optional + back-compat default to "static" — the proxy and
 * every read path are agnostic to source; only logout cares.
 */
export type SessionSource = "static" | "oidc";

export interface ClusterSession {
  token: string;
  identity: string;
  scopes: Scope[];
  source?: SessionSource;
}

export interface SessionData {
  activeClusterId?: string;
  sessions?: Record<string, ClusterSession>;
}

export const sessionOptions: SessionOptions = {
  password: serverEnv.IRON_SESSION_SECRET,
  cookieName: serverEnv.IRON_SESSION_COOKIE_NAME,
  cookieOptions: {
    httpOnly: true,
    sameSite: "strict",
    secure: serverEnv.NODE_ENV === "production",
    maxAge: 60 * 60 * 8, // 8 hours; ops shifts shouldn't outlive this
    path: "/",
  },
};

/**
 * getSession returns the (possibly empty) session for the current
 * request. Mutate the returned object to update; call `.save()`
 * when done. This wraps iron-session's `getIronSession` so call
 * sites stay clean.
 */
export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

/**
 * activeSession resolves the current cluster's bound credentials,
 * or null when the operator hasn't logged into the active cluster.
 * Used by the proxy on every request — null here means 401 to the
 * browser.
 */
export async function activeSession(): Promise<{
  clusterId: string;
  session: ClusterSession;
} | null> {
  const data = await getSession();
  const id = data.activeClusterId;
  if (!id) return null;
  const session = data.sessions?.[id];
  if (!session) return null;
  return { clusterId: id, session };
}
