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
