import { serverEnv } from "@/env/server";
import NextAuth, { type NextAuthConfig } from "next-auth";
import "server-only";

/**
 * auth.js v5 configuration. The monitor uses the generic OIDC
 * provider so any IdP that exposes a standards-compliant
 * `/.well-known/openid-configuration` works (Keycloak, Auth0,
 * Microsoft Entra, Okta, generic OIDC). Operators wire their
 * specific IdP via env vars validated in `serverEnv`.
 *
 * Phase C scope: this module is a thin auth.js wrapper. The
 * actual login UX seal-into-iron-session step lives in
 * `src/app/api/auth/oidc-callback/route.ts` — auth.js handles the
 * OAuth dance, but the per-cluster bearer binding is iron-session
 * shape because every existing surface (proxy, layout, picker)
 * already reads from there.
 *
 * Why "isOIDCEnabled" rather than always-construct: when
 * AUTH_OIDC_ISSUER is unset, the entire OIDC code path is dead
 * weight — the monitor falls back to its existing token-paste
 * flow. Constructing an auth.js handler with empty config would
 * fail at request time with confusing errors; isOIDCEnabled lets
 * callers branch cleanly.
 */

export const isOIDCEnabled = serverEnv.AUTH_OIDC_ISSUER !== undefined;

/**
 * makeAuthConfig returns the NextAuthConfig used by auth.js. Split
 * from the NextAuth() factory so unit tests can assert the config
 * shape (provider id, issuer, callbacks present) without standing
 * up an auth.js runtime.
 *
 * The config is stable per-process (env-driven). Callbacks
 * persist `access_token` + `refresh_token` on the JWT-strategy
 * session so the post-callback handler can seal the access token
 * into iron-session.
 */
export function makeAuthConfig(): NextAuthConfig {
  // The undefined guards are belt-and-suspenders: zod's
  // superRefine in src/env/server.ts already rejects partial
  // config at boot, but TypeScript's narrow types don't reflect
  // that cross-field constraint, so we re-narrow here.
  const issuer = serverEnv.AUTH_OIDC_ISSUER;
  const clientId = serverEnv.AUTH_OIDC_CLIENT_ID;
  const clientSecret = serverEnv.AUTH_OIDC_CLIENT_SECRET;
  if (
    issuer === undefined ||
    clientId === undefined ||
    clientSecret === undefined
  ) {
    throw new Error(
      "auth.js called with missing OIDC config; should be unreachable post-zod-refine",
    );
  }

  return {
    secret: serverEnv.AUTH_SECRET,
    providers: [
      {
        id: "oidc",
        name: serverEnv.AUTH_OIDC_PROVIDER_NAME,
        type: "oidc",
        issuer,
        clientId,
        clientSecret,
        authorization: { params: { scope: serverEnv.AUTH_OIDC_SCOPES } },
        // wellKnown is canonical OIDC discovery — the IdP's
        // metadata document at `<issuer>/.well-known/...`. Auth.js
        // will fetch it on first sign-in to discover endpoints.
        wellKnown: `${issuer}/.well-known/openid-configuration`,
      },
    ],
    session: { strategy: "jwt" },
    // trustHost — for proxied deployments (k8s ingress, nginx),
    // auth.js needs to trust the X-Forwarded-Host header to build
    // correct callback URLs. Production deployments terminate TLS
    // at the proxy; without trustHost the redirect URL would be
    // built from the in-cluster service name and the IdP would
    // reject the callback as a redirect_uri mismatch.
    //
    // Auth.js v5 also enforces trustHost on its own POST /signin
    // CSRF check: if the host isn't whitelisted, the request is
    // 500'd at the auth.js layer with a "Server error" config
    // message. We trust the host regardless of NODE_ENV — every
    // supported deployment terminates TLS at a known proxy or runs
    // on localhost. Operators who need stricter Host validation
    // should put a WAF in front of the monitor.
    trustHost: true,
    callbacks: {
      // jwt callback fires on every request that needs a session.
      // Three branches:
      //
      //   1. First call (right after the IdP returns): `account`
      //      is populated. Copy access_token + refresh_token +
      //      expires_at onto the JWT.
      //   2. Subsequent calls with an unexpired token: pass through.
      //   3. Subsequent calls with an expired token: refresh against
      //      the IdP's token endpoint using the refresh_token, return
      //      the new shape. Failures fall back to the old token with
      //      `error: "RefreshAccessTokenError"` set so the iron-
      //      session bridge can decide whether to keep using the
      //      stale token or bounce to /login.
      //
      // The 30-second skew before expiry covers clock drift between
      // the monitor process and the IdP and avoids round-tripping
      // a token that's *almost* expired and would 401 on the cache
      // mid-flight.
      async jwt({ token, account }) {
        if (account) {
          // Compute expiresAt from whichever shape the IdP returned.
          // Keycloak (and most IdPs) return `expires_in` (seconds);
          // auth.js v5 typically also populates `expires_at` (Unix
          // ts). We accept either and fall back to "unknown" on
          // anything non-numeric so a partial OAuth response can't
          // produce NaN-as-number that later fails the
          // typeof === "number" check on read.
          const expiresAt = computeExpiresAt(
            account.expires_at,
            account.expires_in,
          );
          return {
            ...token,
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            // idToken kept around for RP-initiated logout: the
            // end_session_endpoint requires `id_token_hint` to
            // identify which IdP session to terminate.
            idToken: account.id_token,
            expiresAt,
            // Clear any prior refresh-error marker on a fresh login.
            error: undefined,
          };
        }

        const expiresAt =
          typeof token.expiresAt === "number" &&
          Number.isFinite(token.expiresAt)
            ? token.expiresAt
            : undefined;

        // No expiry on the token — common cause is a stale cookie
        // from before the expires_in fallback shipped. Trust the
        // access token until the cache 401s; refresh-on-blind would
        // chew through Keycloak's refresh-rotation budget for no
        // good reason and produce the exact "Invalid refresh token"
        // loop this branch was added to fix.
        if (expiresAt === undefined) {
          return token;
        }

        // 30-second skew before we consider the token expired.
        if (Date.now() / 1000 < expiresAt - 30) {
          return token;
        }

        const refreshToken =
          typeof token.refreshToken === "string" ? token.refreshToken : "";
        if (refreshToken === "") {
          // No refresh token (e.g. IdP didn't return one) — mark
          // for re-login on next read.
          return { ...token, error: "RefreshAccessTokenError" as const };
        }

        try {
          return await dedupedRefresh(token, refreshToken);
        } catch (err) {
          console.error("[auth] token refresh failed:", err);
          return { ...token, error: "RefreshAccessTokenError" as const };
        }
      },
      // session callback shapes the public-facing session. We
      // surface accessToken + error on the session so:
      //   - the post-callback route reads accessToken to seal
      //     iron-session at first sign-in, and
      //   - the proxy reads accessToken on every upstream call so
      //     refreshes propagate without a re-seal of iron-session,
      //     and reads `error` to decide whether to bounce the
      //     operator back to /login.
      session({ session, token }) {
        const augmented = session as typeof session & {
          accessToken?: string;
          idToken?: string;
          error?: string;
        };
        augmented.accessToken =
          typeof token.accessToken === "string" ? token.accessToken : undefined;
        augmented.idToken =
          typeof token.idToken === "string" ? token.idToken : undefined;
        augmented.error =
          typeof token.error === "string" ? token.error : undefined;
        return augmented;
      },
    },
  };
}

/**
 * refreshAccessToken exchanges the refresh_token for a fresh
 * access_token at the IdP's token endpoint. Standard OAuth2
 * `grant_type=refresh_token` flow — no auth.js helpers because
 * v5 deliberately doesn't ship a built-in refresher (every IdP
 * has slightly different rotation semantics).
 *
 * The token endpoint URL is discovered from the IdP's
 * `/.well-known/openid-configuration` rather than hardcoded —
 * Keycloak's path differs from Auth0's differs from Okta's, and
 * the discovery doc is the authoritative source. The result is
 * cached for the process lifetime; the discovery doc itself
 * doesn't change between IdP releases.
 *
 * Spec-conforming IdPs may rotate the refresh_token on each use
 * (e.g. Auth0 in rotation mode); others reuse the original
 * forever. We honour either: if the response carries a new
 * refresh_token we adopt it, otherwise the old one stays valid.
 */
/**
 * computeExpiresAt picks an absolute Unix timestamp (seconds since
 * epoch) for the access token's expiry. Most IdPs / auth.js v5
 * populate `account.expires_at` directly; some only emit
 * `expires_in` (relative seconds), and a stale cookie may have
 * neither. The jwt callback uses the result to decide whether to
 * proactively refresh or trust the access token.
 */
function computeExpiresAt(
  expiresAt: number | null | undefined,
  expiresIn: number | null | undefined,
): number | undefined {
  if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) {
    return expiresAt;
  }
  if (typeof expiresIn === "number" && Number.isFinite(expiresIn)) {
    return Math.floor(Date.now() / 1000) + expiresIn;
  }
  return undefined;
}

interface DiscoveryDoc {
  tokenEndpoint: string;
  endSessionEndpoint: string | undefined;
}

let discoveryCache: Promise<DiscoveryDoc> | undefined;

async function discoverEndpoints(issuer: string): Promise<DiscoveryDoc> {
  discoveryCache ??= (async () => {
    const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(
        `OIDC discovery failed: HTTP ${response.status} from ${issuer}`,
      );
    }
    const doc = (await response.json()) as {
      token_endpoint?: string;
      end_session_endpoint?: string;
    };
    if (typeof doc.token_endpoint !== "string") {
      throw new Error(
        `OIDC discovery doc at ${issuer} is missing token_endpoint`,
      );
    }
    return {
      tokenEndpoint: doc.token_endpoint,
      // end_session_endpoint is optional in the OIDC discovery spec
      // — Keycloak/Auth0/Okta advertise it; smaller IdPs may not.
      // RP-initiated logout silently degrades to local-only when
      // it's absent.
      endSessionEndpoint:
        typeof doc.end_session_endpoint === "string"
          ? doc.end_session_endpoint
          : undefined,
    };
  })();
  return discoveryCache;
}

/**
 * inflightRefreshes serializes concurrent refresh attempts for the
 * SAME refresh_token. Without it, two parallel jwt() callbacks
 * (typical when several server components fetch the session in one
 * request, or when sibling requests fire close together) both call
 * the IdP with `R1`; rotation hands `R2` to whoever wins the race,
 * invalidates `R1`, the loser gets `invalid_grant`. With the map,
 * the second caller awaits the first call's promise and shares the
 * result.
 *
 * Keyed by the OLD refresh_token (the input to the refresh). The
 * promise is cleared from the map on completion via finally so the
 * next refresh attempt with a freshly-rotated refresh_token starts
 * a new call.
 */
const inflightRefreshes = new Map<string, Promise<Record<string, unknown>>>();

/**
 * recentRotations caches successful refresh results for a short
 * window keyed by the OLD refresh_token. Covers the case where a
 * request still holding `R1` arrives AFTER a concurrent request
 * already rotated `R1`→`R2`: the in-flight map has cleared, the
 * IdP would reject `R1`, but we have the rotation result cached
 * and return it directly.
 *
 * 30-second TTL: long enough to absorb the typical "started just
 * before rotation" race (one Next.js request lifecycle plus
 * browser-render variability), short enough that genuinely
 * revoked tokens still surface as `RefreshAccessTokenError`
 * within a sane debugging window.
 */
const rotationCacheTTLMs = 30_000;

interface RotationEntry {
  result: Record<string, unknown>;
  expiresAtMs: number;
}

const recentRotations = new Map<string, RotationEntry>();

/**
 * cacheRotation stores the refreshed token shape under the OLD
 * refresh_token key. Called from dedupedRefresh on success.
 */
function cacheRotation(
  oldRefreshToken: string,
  result: Record<string, unknown>,
): void {
  recentRotations.set(oldRefreshToken, {
    result,
    expiresAtMs: Date.now() + rotationCacheTTLMs,
  });
}

/**
 * readRotationCache returns a cached refresh result for the given
 * OLD refresh_token if one exists and is still within TTL.
 * Expired entries are evicted lazily on read; the map stays small
 * because TTL is short and entries are keyed by short-lived
 * refresh_tokens.
 */
function readRotationCache(
  oldRefreshToken: string,
): Record<string, unknown> | undefined {
  const entry = recentRotations.get(oldRefreshToken);
  if (entry === undefined) {
    return undefined;
  }
  if (Date.now() > entry.expiresAtMs) {
    recentRotations.delete(oldRefreshToken);
    return undefined;
  }
  return entry.result;
}

/**
 * dedupedRefresh is the entry point the jwt() callback uses
 * instead of refreshAccessToken directly. It composes the two
 * race-mitigation layers:
 *
 *   1. recent-rotations cache — if a successful rotation for this
 *      refresh_token happened within the last 30s, return the
 *      cached result without hitting the IdP.
 *   2. in-flight dedup — if another caller is currently refreshing
 *      this refresh_token, await their promise and share the
 *      result.
 *   3. fresh call — none of the above; call refreshAccessToken,
 *      cache the success, return.
 *
 * Failures aren't cached (a 400 invalid_grant is terminal for the
 * caller anyway; the next call should re-attempt, not reuse the
 * error). Inflight entries are cleared in finally regardless of
 * outcome.
 */
async function dedupedRefresh(
  token: Record<string, unknown>,
  refreshToken: string,
): Promise<Record<string, unknown>> {
  const cached = readRotationCache(refreshToken);
  if (cached !== undefined) {
    return cached;
  }

  const existing = inflightRefreshes.get(refreshToken);
  if (existing !== undefined) {
    return existing;
  }

  const promise = refreshAccessToken(token, refreshToken)
    .then((result) => {
      cacheRotation(refreshToken, result);
      return result;
    })
    .finally(() => {
      inflightRefreshes.delete(refreshToken);
    });

  inflightRefreshes.set(refreshToken, promise);
  return promise;
}

/**
 * resetRefreshCachesForTests is a test-only hook that clears the
 * module-level inflight + rotation maps so each test starts from
 * a clean state. Production code never calls this — leaving it
 * exported keeps the maps' lifecycle off the public API while
 * making the tests' state-isolation requirements explicit.
 */
export function resetRefreshCachesForTests(): void {
  inflightRefreshes.clear();
  recentRotations.clear();
}

async function refreshAccessToken(
  token: Record<string, unknown>,
  refreshToken: string,
): Promise<Record<string, unknown>> {
  const issuer = serverEnv.AUTH_OIDC_ISSUER;
  const clientId = serverEnv.AUTH_OIDC_CLIENT_ID;
  const clientSecret = serverEnv.AUTH_OIDC_CLIENT_SECRET;
  if (
    issuer === undefined ||
    clientId === undefined ||
    clientSecret === undefined
  ) {
    throw new Error(
      "refresh called with missing OIDC config; should be unreachable",
    );
  }

  const { tokenEndpoint } = await discoverEndpoints(issuer);
  const tokenUrl = tokenEndpoint;
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
    cache: "no-store",
  });

  const refreshed = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || refreshed.access_token === undefined) {
    throw new Error(
      `refresh_token grant failed: HTTP ${response.status} ${refreshed.error ?? ""} ${refreshed.error_description ?? ""}`.trim(),
    );
  }

  return {
    ...token,
    accessToken: refreshed.access_token,
    expiresAt:
      typeof refreshed.expires_in === "number"
        ? Math.floor(Date.now() / 1000) + refreshed.expires_in
        : token.expiresAt,
    // Spec-compliant rotation: keep new refresh token if returned,
    // otherwise reuse the original.
    refreshToken: refreshed.refresh_token ?? refreshToken,
    error: undefined,
  };
}

/**
 * rpInitiatedLogout terminates the IdP-side session via the
 * `end_session_endpoint` advertised in the IdP's discovery doc.
 *
 * Per the OIDC RP-Initiated Logout spec (1.0), `id_token_hint`
 * identifies which session to terminate without requiring an
 * additional auth dance. Auth.js v5's `signOut()` does NOT issue
 * this call by default — it only clears its local cookie — so we
 * call this helper from the logout route alongside `signOut()`.
 *
 * Returns true on a 2xx/3xx from the IdP (logout accepted), false
 * on any other response (logout silently failed, but local
 * cookies are still cleared by the caller — best-effort by design).
 *
 * Returns false also when:
 *   - OIDC is disabled (no IdP to call)
 *   - IdP doesn't advertise end_session_endpoint
 *   - idToken is missing (operator's auth.js cookie didn't carry one)
 *
 * The caller wraps this in try/catch — discovery + IdP call are
 * both fail-loud here so test failures surface; production logs
 * the failure without blocking the iron-session destroy.
 */
export async function rpInitiatedLogout(idToken: string): Promise<boolean> {
  if (!isOIDCEnabled) return false;
  const issuer = serverEnv.AUTH_OIDC_ISSUER;
  if (issuer === undefined) return false;

  const { endSessionEndpoint } = await discoverEndpoints(issuer);
  if (endSessionEndpoint === undefined) return false;

  const url = new URL(endSessionEndpoint);
  url.searchParams.set("id_token_hint", idToken);

  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
  });

  // Keycloak returns 302 to post_logout_redirect_uri (or its login
  // page) on success; treat any non-error status as success since
  // we deliberately don't follow the redirect — we just want the
  // server-side session torn down.
  return (
    response.status < 400 || response.status === 302 || response.status === 303
  );
}

/**
 * authNoOp is the placeholder returned when OIDC is disabled.
 * Callers (route handlers, login page) check `isOIDCEnabled`
 * before invoking auth.js — but if a stale call slips through,
 * authNoOp throws so the bug surfaces loudly instead of silently
 * returning an empty session. Returns `never` so TypeScript
 * narrows the union types correctly at call sites.
 */
function authNoOp(): never {
  throw new Error(
    "auth.js called but OIDC is disabled (AUTH_OIDC_ISSUER unset); " +
      "guard call sites with `isOIDCEnabled`",
  );
}

const constructed = isOIDCEnabled ? NextAuth(makeAuthConfig()) : null;

/**
 * Public auth.js handlers + helpers. When OIDC is disabled, every
 * export is a thrower — callers MUST gate on `isOIDCEnabled`. The
 * thrower's `never` return type mirrors auth.js's own shape so
 * TypeScript types check uniformly across both branches.
 */
export const handlers = constructed?.handlers ?? {
  GET: authNoOp,
  POST: authNoOp,
};

export const auth = constructed?.auth ?? authNoOp;
export const signIn = constructed?.signIn ?? authNoOp;
export const signOut = constructed?.signOut ?? authNoOp;
