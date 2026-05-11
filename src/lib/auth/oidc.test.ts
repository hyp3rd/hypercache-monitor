import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase C OIDC factory smoke tests. Pins:
 *   - `isOIDCEnabled` reflects AUTH_OIDC_ISSUER presence
 *   - `makeAuthConfig()` returns a NextAuthConfig with the
 *     generic OIDC provider wired (issuer, clientId, secret,
 *     wellKnown URL, scopes)
 *   - `makeAuthConfig()` throws the unreachable-guard when
 *     called against partial env (defense-in-depth above zod)
 *
 * These are smoke tests, not auth.js runtime tests. The
 * NextAuth() factory is imported transitively at module-eval
 * time, but its internals are an integration concern we cover
 * in the E2E flow.
 */

const VALID_SECRET = "x".repeat(48); // satisfies min(32) — generated value-shape, not a real secret

const clearOIDCEnv = () => {
  delete process.env.AUTH_OIDC_ISSUER;
  delete process.env.AUTH_OIDC_CLIENT_ID;
  delete process.env.AUTH_OIDC_CLIENT_SECRET;
  delete process.env.AUTH_OIDC_PROVIDER_NAME;
  delete process.env.AUTH_OIDC_SCOPES;
  delete process.env.AUTH_SECRET;
};

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isOIDCEnabled", () => {
  it("is false when AUTH_OIDC_ISSUER is unset", async () => {
    clearOIDCEnv();
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("HYPERCACHE_API_URL", "http://cache:8080");
    vi.stubEnv("HYPERCACHE_MGMT_URL", "http://cache:8081");
    vi.stubEnv("IRON_SESSION_SECRET", VALID_SECRET);

    const { isOIDCEnabled } = await import("./oidc");
    expect(isOIDCEnabled).toBe(false);
  });

  it("is true when AUTH_OIDC_ISSUER + the rest are set", async () => {
    clearOIDCEnv();
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("HYPERCACHE_API_URL", "http://cache:8080");
    vi.stubEnv("HYPERCACHE_MGMT_URL", "http://cache:8081");
    vi.stubEnv("IRON_SESSION_SECRET", VALID_SECRET);
    vi.stubEnv("AUTH_OIDC_ISSUER", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "client-abc");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "client-secret-xyz");
    vi.stubEnv("AUTH_SECRET", VALID_SECRET);

    const { isOIDCEnabled } = await import("./oidc");
    expect(isOIDCEnabled).toBe(true);
  });
});

describe("makeAuthConfig", () => {
  it("returns a config wired to the generic OIDC provider when env is full", async () => {
    clearOIDCEnv();
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("HYPERCACHE_API_URL", "http://cache:8080");
    vi.stubEnv("HYPERCACHE_MGMT_URL", "http://cache:8081");
    vi.stubEnv("IRON_SESSION_SECRET", VALID_SECRET);
    vi.stubEnv("AUTH_OIDC_ISSUER", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "client-abc");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "client-secret-xyz");
    vi.stubEnv("AUTH_OIDC_PROVIDER_NAME", "Acme SSO");
    vi.stubEnv("AUTH_OIDC_SCOPES", "openid profile email cache_scopes");
    vi.stubEnv("AUTH_SECRET", VALID_SECRET);

    const { makeAuthConfig } = await import("./oidc");
    const cfg = makeAuthConfig();

    // Provider shape — generic OIDC, issuer-derived wellKnown URL,
    // env-driven name + scopes.
    expect(cfg.providers).toHaveLength(1);
    const provider = cfg.providers[0] as unknown as Record<string, unknown> & {
      authorization?: { params?: { scope?: string } };
    };
    expect(provider.id).toBe("oidc");
    expect(provider.name).toBe("Acme SSO");
    expect(provider.type).toBe("oidc");
    expect(provider.issuer).toBe("https://idp.example.com");
    expect(provider.clientId).toBe("client-abc");
    expect(provider.clientSecret).toBe("client-secret-xyz");
    expect(provider.wellKnown).toBe(
      "https://idp.example.com/.well-known/openid-configuration",
    );
    expect(provider.authorization?.params?.scope).toBe(
      "openid profile email cache_scopes",
    );

    // Stateless JWT session — fits the iron-session bridge model.
    expect(cfg.session?.strategy).toBe("jwt");

    // Callbacks present — the post-callback handler reads
    // accessToken off the session shape they augment.
    expect(typeof cfg.callbacks?.jwt).toBe("function");
    expect(typeof cfg.callbacks?.session).toBe("function");

    // secret echoes AUTH_SECRET so auth.js can sign its JWT.
    expect(cfg.secret).toBe(VALID_SECRET);
  });

  it("trustHost is true regardless of NODE_ENV (auth.js v5 CSRF gate needs it)", async () => {
    clearOIDCEnv();
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("HYPERCACHE_API_URL", "http://cache:8080");
    vi.stubEnv("HYPERCACHE_MGMT_URL", "http://cache:8081");
    vi.stubEnv("IRON_SESSION_SECRET", VALID_SECRET);
    vi.stubEnv("AUTH_OIDC_ISSUER", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "client-abc");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "client-secret-xyz");
    vi.stubEnv("AUTH_SECRET", VALID_SECRET);

    const { makeAuthConfig } = await import("./oidc");
    expect(makeAuthConfig().trustHost).toBe(true);
  });
});

describe("jwt callback (token refresh)", () => {
  /**
   * The jwt callback has three hot branches we want pinned:
   *   1. First call after sign-in — `account` is set, copy access/
   *      refresh/expires onto the JWT.
   *   2. Subsequent call within validity (with skew) — passes through
   *      the existing token unchanged.
   *   3. Subsequent call after expiry — refreshes against the IdP's
   *      token endpoint via discovery, returns the new token shape.
   *      Failure path stamps `error: RefreshAccessTokenError` so the
   *      iron-session bridge can decide to bounce to /login.
   *
   * The callback's signature comes from auth.js's NextAuthConfig
   * callbacks; we extract it from makeAuthConfig() and exercise it
   * directly without touching the auth.js runtime.
   */

  const setOIDCEnv = () => {
    clearOIDCEnv();
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("HYPERCACHE_API_URL", "http://cache:8080");
    vi.stubEnv("HYPERCACHE_MGMT_URL", "http://cache:8081");
    vi.stubEnv("IRON_SESSION_SECRET", VALID_SECRET);
    vi.stubEnv("AUTH_OIDC_ISSUER", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "client-abc");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "client-secret-xyz");
    vi.stubEnv("AUTH_SECRET", VALID_SECRET);
  };

  // Each test sets up env, imports oidc module fresh, gets the jwt
  // callback. Defining a tiny harness keeps each `it` focused on
  // the branch under test.
  type JwtCallback = (args: {
    token: Record<string, unknown>;
    account?: {
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
    } | null;
  }) => Promise<Record<string, unknown>> | Record<string, unknown>;

  const loadJwtCallback = async (): Promise<JwtCallback> => {
    const { makeAuthConfig } = await import("./oidc");
    const cb = makeAuthConfig().callbacks?.jwt;
    if (typeof cb !== "function") {
      throw new Error("jwt callback missing");
    }
    return cb as unknown as JwtCallback;
  };

  it("first call (account set) copies access/refresh/expires onto the JWT", async () => {
    setOIDCEnv();
    const jwt = await loadJwtCallback();

    const result = await jwt({
      token: {},
      account: {
        access_token: "first-access",
        refresh_token: "first-refresh",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    });

    expect(result.accessToken).toBe("first-access");
    expect(result.refreshToken).toBe("first-refresh");
    expect(typeof result.expiresAt).toBe("number");
    expect(result.error).toBeUndefined();
  });

  it("subsequent call within validity passes the token through unchanged", async () => {
    setOIDCEnv();
    const jwt = await loadJwtCallback();

    const future = Math.floor(Date.now() / 1000) + 600;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await jwt({
      token: {
        accessToken: "valid-token",
        refreshToken: "valid-refresh",
        expiresAt: future,
        custom: "preserved",
      },
    });

    // No IdP traffic on the happy-pass path.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.accessToken).toBe("valid-token");
    expect(result.custom).toBe("preserved");
    fetchSpy.mockRestore();
  });

  it("expired token triggers refresh via discovery + token endpoint", async () => {
    setOIDCEnv();
    const jwt = await loadJwtCallback();

    const past = Math.floor(Date.now() / 1000) - 60;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url =
          typeof input === "string" ? input : (input as URL).toString();
        if (url.endsWith("/.well-known/openid-configuration")) {
          return new Response(
            JSON.stringify({
              token_endpoint: "https://idp.example.com/oauth/token",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url === "https://idp.example.com/oauth/token") {
          return new Response(
            JSON.stringify({
              access_token: "refreshed-access",
              refresh_token: "rotated-refresh",
              expires_in: 3600,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      });

    const result = await jwt({
      token: {
        accessToken: "stale-access",
        refreshToken: "old-refresh",
        expiresAt: past,
      },
    });

    expect(result.accessToken).toBe("refreshed-access");
    // Rotation: the new refresh_token replaces the old one.
    expect(result.refreshToken).toBe("rotated-refresh");
    expect(result.error).toBeUndefined();
    fetchMock.mockRestore();
  });

  it("refresh failure stamps error: RefreshAccessTokenError on the token", async () => {
    setOIDCEnv();
    const jwt = await loadJwtCallback();

    const past = Math.floor(Date.now() / 1000) - 60;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url =
          typeof input === "string" ? input : (input as URL).toString();
        if (url.endsWith("/.well-known/openid-configuration")) {
          return new Response(
            JSON.stringify({
              token_endpoint: "https://idp.example.com/oauth/token",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        // IdP rejects the refresh (e.g. session revoked).
        return new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      });
    const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await jwt({
      token: {
        accessToken: "stale-access",
        refreshToken: "revoked-refresh",
        expiresAt: past,
      },
    });

    expect(result.error).toBe("RefreshAccessTokenError");
    // Old token preserved on failure so a subsequent read can decide
    // (the iron-session bridge bounces to /login on this marker).
    expect(result.accessToken).toBe("stale-access");

    fetchMock.mockRestore();
    warnSpy.mockRestore();
  });

  it("missing refresh_token on an expired token short-circuits to error (no fetch)", async () => {
    setOIDCEnv();
    const jwt = await loadJwtCallback();

    const past = Math.floor(Date.now() / 1000) - 60;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await jwt({
      token: { accessToken: "stale-access", expiresAt: past },
    });

    expect(result.error).toBe("RefreshAccessTokenError");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("falls back to account.expires_in when account.expires_at is missing", async () => {
    // Real-world: a few IdPs and some auth.js versions only populate
    // `expires_in` (relative seconds) rather than `expires_at`
    // (absolute Unix ts). Without the fallback, the jwt's expiresAt
    // ends up undefined → defaulted to 0 → looks expired → triggers
    // a refresh on a freshly-issued token. That's the loop the user
    // hit ("auth works, but redirects to login").
    setOIDCEnv();
    const jwt = await loadJwtCallback();

    const result = await jwt({
      token: {},
      account: {
        access_token: "fresh-access",
        refresh_token: "fresh-refresh",
        // No expires_at — only expires_in (the IdP's response shape).
        expires_in: 3600,
      } as unknown as Parameters<typeof jwt>[0]["account"],
    });

    expect(typeof result.expiresAt).toBe("number");
    // Should be ~3600 seconds in the future, well past the 30s skew.
    const nowSec = Math.floor(Date.now() / 1000);
    expect(result.expiresAt).toBeGreaterThan(nowSec + 3000);
  });

  it("token without expiresAt is passed through unchanged (no refresh blind-fire)", async () => {
    // Defensive: a stale cookie from before the expires_in fallback
    // could carry no expiresAt at all. The previous behavior
    // defaulted to 0 and burned the refresh_token on every read;
    // now we trust the access token until the cache 401s.
    setOIDCEnv();
    const jwt = await loadJwtCallback();

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await jwt({
      token: { accessToken: "no-expiry-info", refreshToken: "rt" },
    });

    expect(result.accessToken).toBe("no-expiry-info");
    expect(result.error).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
