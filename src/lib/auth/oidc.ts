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
      // First call (right after the IdP returns) carries `account`
      // populated with the OIDC token response; we copy access_token
      // + refresh_token onto the JWT so subsequent callbacks (and
      // our post-callback handler) can read them.
      jwt({ token, account }) {
        if (account) {
          token.accessToken = account.access_token;
          token.refreshToken = account.refresh_token;
          token.expiresAt = account.expires_at;
        }
        return token;
      },
      // session callback shapes the public-facing session. We
      // surface accessToken on the session for the post-callback
      // route to read; auth.js's `session()` helper returns this
      // shape on every server-side call.
      session({ session, token }) {
        // Augment the session with the IdP's access token. The
        // type cast is necessary because auth.js's `Session`
        // type doesn't know about our custom claims.
        const augmented = session as typeof session & { accessToken?: string };
        augmented.accessToken =
          typeof token.accessToken === "string" ? token.accessToken : undefined;
        return augmented;
      },
    },
  };
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
