import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pins the activeSession bridge for OIDC token refresh:
 *
 *   - `source: "static"` sessions return the iron-session-stored
 *     token unchanged. The bridge does not consult auth.js.
 *   - `source: "oidc"` sessions overlay the iron-session-stored
 *     token with auth.js's current accessToken (which the jwt
 *     callback refreshes against the IdP automatically).
 *   - `source: "oidc"` + `error: "RefreshAccessTokenError"` on the
 *     auth.js session resolves to `null` so the proxy 401s and the
 *     operator gets bounced to /login.
 *   - When OIDC is disabled at the env layer, the bridge skips the
 *     auth.js dynamic import entirely.
 *
 * These cover the contract the proxy depends on — without them, a
 * regression in oidc.ts could silently leave operators with stale
 * tokens that 401 mid-flight against the cache.
 */

const VALID_SECRET = "x".repeat(48);

const setOIDCEnv = () => {
  process.env.NEXT_PHASE = "";
  process.env.HYPERCACHE_API_URL = "http://cache:8080";
  process.env.HYPERCACHE_MGMT_URL = "http://cache:8081";
  process.env.IRON_SESSION_SECRET = VALID_SECRET;
  process.env.AUTH_OIDC_ISSUER = "https://idp.example.com";
  process.env.AUTH_OIDC_CLIENT_ID = "client-abc";
  process.env.AUTH_OIDC_CLIENT_SECRET = "client-secret-xyz";
  process.env.AUTH_SECRET = VALID_SECRET;
};

const clearOIDCEnv = () => {
  delete process.env.AUTH_OIDC_ISSUER;
  delete process.env.AUTH_OIDC_CLIENT_ID;
  delete process.env.AUTH_OIDC_CLIENT_SECRET;
  delete process.env.AUTH_OIDC_PROVIDER_NAME;
  delete process.env.AUTH_OIDC_SCOPES;
  delete process.env.AUTH_SECRET;
  delete process.env.AUTH_URL;
};

const sessionData: {
  activeClusterId?: string;
  sessions?: Record<string, unknown>;
} = {};

vi.mock("iron-session", () => ({
  getIronSession: vi.fn(async () => sessionData),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({}) as never) }));

const authMock = vi.fn();
vi.mock("./oidc", () => ({ auth: () => authMock(), isOIDCEnabled: true }));

beforeEach(() => {
  authMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("activeSession bridge", () => {
  it("returns a static-bearer session unchanged (does not call auth.js)", async () => {
    setOIDCEnv();
    sessionData.activeClusterId = "default";
    sessionData.sessions = {
      default: {
        token: "static-token",
        identity: "ops",
        scopes: ["read", "write"],
        source: "static",
      },
    };

    const { activeSession } = await import("./session");
    const result = await activeSession();

    expect(result?.session.token).toBe("static-token");
    expect(authMock).not.toHaveBeenCalled();
  });

  it("overlays an OIDC session with the current auth.js access token (refresh propagation)", async () => {
    setOIDCEnv();
    sessionData.activeClusterId = "default";
    sessionData.sessions = {
      default: {
        token: "stale-stored",
        identity: "alice",
        scopes: ["read"],
        source: "oidc",
      },
    };
    authMock.mockResolvedValueOnce({ accessToken: "freshly-refreshed" });

    const { activeSession } = await import("./session");
    const result = await activeSession();

    expect(result?.session.token).toBe("freshly-refreshed");
    expect(result?.session.identity).toBe("alice");
    expect(result?.session.scopes).toEqual(["read"]);
  });

  it("returns null on RefreshAccessTokenError so the proxy 401s and the operator bounces to /login", async () => {
    setOIDCEnv();
    sessionData.activeClusterId = "default";
    sessionData.sessions = {
      default: {
        token: "stale-stored",
        identity: "alice",
        scopes: ["read"],
        source: "oidc",
      },
    };
    authMock.mockResolvedValueOnce({
      accessToken: "stale-stored",
      error: "RefreshAccessTokenError",
    });

    const { activeSession } = await import("./session");
    const result = await activeSession();

    expect(result).toBeNull();
  });

  it("returns null when source=oidc and auth.js has no accessToken (auth.js cookie expired/cleared)", async () => {
    // The OIDC oidc-callback handler stores an empty token in
    // iron-session for OIDC sources — the live token comes from
    // auth.js's bridge. If auth.js has no session, we have NO
    // usable token: bouncing to /login is the correct shape.
    setOIDCEnv();
    sessionData.activeClusterId = "default";
    sessionData.sessions = {
      default: {
        token: "",
        identity: "alice",
        scopes: ["read"],
        source: "oidc",
      },
    };
    authMock.mockResolvedValueOnce(null);

    const { activeSession } = await import("./session");
    const result = await activeSession();

    expect(result).toBeNull();
  });

  it("when OIDC is disabled at env layer for an OIDC-sourced binding, returns null (orphaned session)", async () => {
    // Disabling OIDC mid-flight (e.g., env reload) leaves any
    // OIDC-sourced binding without a live-token source. The stored
    // token is empty by design (size guard), so we return null and
    // the operator gets bounced to /login.
    clearOIDCEnv();
    process.env.NEXT_PHASE = "";
    process.env.HYPERCACHE_API_URL = "http://cache:8080";
    process.env.HYPERCACHE_MGMT_URL = "http://cache:8081";
    process.env.IRON_SESSION_SECRET = VALID_SECRET;

    sessionData.activeClusterId = "default";
    sessionData.sessions = {
      default: { token: "", identity: "ops", scopes: ["read"], source: "oidc" },
    };

    const { activeSession } = await import("./session");
    const result = await activeSession();

    expect(result).toBeNull();
    expect(authMock).not.toHaveBeenCalled();
  });
});
