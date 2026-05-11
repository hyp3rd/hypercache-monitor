import { serverEnv } from "@/env/server";
import type { SessionOptions } from "iron-session";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
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

/**
 * `secure: true` requires HTTPS — Chrome / Firefox / Safari treat
 * a Set-Cookie carrying `Secure` over plain `http://` (other than
 * the special `localhost` case in some browsers) as MUST-DROP. The
 * earlier blanket `secure: NODE_ENV === "production"` set the flag
 * unconditionally in our docker example, where the operator-visible
 * URL is `http://localhost:3000` — so the cookie was set, never
 * stored, and the proxy bounced every navigation to /login.
 *
 * Right gate: HTTPS in the canonical URL. We look at `AUTH_URL`
 * first (set explicitly for proxied deployments per Phase C+),
 * and fall back to a conservative "NODE_ENV=production AND no
 * AUTH_URL" — that branch only triggers in a misconfigured
 * production deployment we're already shouting about in the
 * env-validator.
 */
const cookieSecure: boolean = (() => {
  if (serverEnv.AUTH_URL !== undefined) {
    return new URL(serverEnv.AUTH_URL).protocol === "https:";
  }
  return serverEnv.NODE_ENV === "production";
})();

export const sessionOptions: SessionOptions = {
  password: serverEnv.IRON_SESSION_SECRET,
  cookieName: serverEnv.IRON_SESSION_COOKIE_NAME,
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
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
 * getSessionFor binds iron-session to a specific Request/Response
 * pair. Use this on routes that return `NextResponse.redirect()`
 * — Next.js's auto-merge of cookies set via `cookies()` doesn't
 * always propagate onto a freshly-constructed `NextResponse`, so
 * `session.save()` here writes the `Set-Cookie` header directly
 * onto the response object the caller will return. The
 * cookieStore overload (above) is fine for routes that return
 * JSON or HTML; the response overload is the safer shape for
 * redirects.
 */
export async function getSessionFor(req: NextRequest, res: NextResponse) {
  return getIronSession<SessionData>(req, res, sessionOptions);
}

/**
 * activeSession resolves the current cluster's bound credentials,
 * or null when the operator hasn't logged into the active cluster.
 * Used by the proxy on every request — null here means 401 to the
 * browser.
 *
 * For OIDC-sourced sessions the bearer overlay-reads from auth.js
 * (see `oidcBearerOverride` below). Auth.js's jwt callback handles
 * automatic refresh against the IdP; the iron-session-stored token
 * may be stale. We use auth.js's current token when present and
 * surface a refresh-error as `null` so the proxy 401s and the
 * operator gets bounced to /login.
 */
export async function activeSession(): Promise<{
  clusterId: string;
  session: ClusterSession;
} | null> {
  const data = await getSession();
  const id = data.activeClusterId;
  if (!id) return null;
  const stored = data.sessions?.[id];
  if (!stored) return null;

  if (stored.source === "oidc") {
    const overlay = await oidcBearerOverride();
    if (overlay === "refresh-failed") return null;
    if (overlay !== null) {
      return { clusterId: id, session: { ...stored, token: overlay } };
    }
    // OIDC-sourced binding but no live token from auth.js: the
    // auth.js cookie expired or was cleared. The stored token in
    // iron-session is intentionally empty for OIDC (see the
    // oidc-callback handler for why), so we can't fall back to it.
    // Treat as unauthenticated.
    return null;
  }

  return { clusterId: id, session: stored };
}

/**
 * oidcBearerOverride asks auth.js for the current access_token.
 * Auth.js's jwt callback (src/lib/auth/oidc.ts) refreshes the
 * token against the IdP automatically; we just read the current
 * value here on every request.
 *
 * Three return shapes:
 *   - string                — the (possibly refreshed) access_token
 *   - null                  — auth.js has no session OR no
 *                             accessToken on it; fall back to the
 *                             iron-session-stored token (may be
 *                             stale; this happens for static-bearer
 *                             sessions or pre-refresh-feature seals)
 *   - "refresh-failed"      — auth.js's jwt callback flagged a
 *                             refresh failure; bounce to /login
 *
 * The dynamic import keeps this module's static dependency graph
 * free of auth.js when OIDC is disabled — `serverEnv.AUTH_OIDC_ISSUER`
 * gates whether we even try to construct the auth.js handlers.
 * Sealing iron-session for an OIDC source already requires OIDC to
 * have been enabled at the time of seal; if the operator's
 * environment changed since then this gracefully falls back to the
 * stored token.
 */
async function oidcBearerOverride(): Promise<string | null | "refresh-failed"> {
  if (serverEnv.AUTH_OIDC_ISSUER === undefined) {
    return null;
  }
  const { auth, isOIDCEnabled } = await import("./oidc");
  if (!isOIDCEnabled) return null;
  const session = (await auth()) as {
    accessToken?: string;
    error?: string;
  } | null;
  if (session?.error === "RefreshAccessTokenError") return "refresh-failed";
  if (typeof session?.accessToken === "string") return session.accessToken;
  return null;
}
