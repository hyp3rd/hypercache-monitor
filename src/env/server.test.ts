import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pins the env-loader's two operational modes:
 *   - runtime: zod validates `process.env` at module load and
 *     fails fast on missing/invalid fields (the auth-bypass
 *     prevention property)
 *   - build: NEXT_PHASE=phase-production-build skips validation
 *     so `next build` page-data collection succeeds without
 *     runtime secrets in the build context (Docker image build)
 *
 * Each test re-imports the module via `vi.resetModules()` so the
 * top-level `loadEnv()` evaluates against the freshly stubbed
 * env. Without resetModules the first import would cache the
 * module evaluation and subsequent stubs would be invisible.
 */

const VALID_SECRET = "x".repeat(48); // satisfies min(32) — generated value-shape, not a real secret

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("env/server runtime mode", () => {
  it("throws on missing IRON_SESSION_SECRET (the only env-validator-required field post-C1)", async () => {
    // Phase C1 made HYPERCACHE_API_URL / HYPERCACHE_MGMT_URL
    // optional in the env validator (the cluster loader enforces
    // "at least one cluster source is configured" separately).
    // IRON_SESSION_SECRET is still strictly required here — no
    // session sealing without it.
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("HYPERCACHE_API_URL", "");
    vi.stubEnv("HYPERCACHE_MGMT_URL", "");
    vi.stubEnv("HYPERCACHE_MONITOR_CLUSTERS", "");
    vi.stubEnv("IRON_SESSION_SECRET", "");

    await expect(import("./server")).rejects.toThrow(
      /Invalid environment for hypercache-monitor/,
    );
  });

  it("throws when IRON_SESSION_SECRET is too short (zod min(32))", async () => {
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("HYPERCACHE_API_URL", "http://cache:8080");
    vi.stubEnv("HYPERCACHE_MGMT_URL", "http://cache:8081");
    vi.stubEnv("IRON_SESSION_SECRET", "too-short");

    await expect(import("./server")).rejects.toThrow(/IRON_SESSION_SECRET/);
  });

  it("loads with parsed values + applied defaults when env is valid", async () => {
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("HYPERCACHE_API_URL", "http://cache:8080");
    vi.stubEnv("HYPERCACHE_MGMT_URL", "http://cache:8081");
    vi.stubEnv("IRON_SESSION_SECRET", VALID_SECRET);
    vi.stubEnv("NODE_ENV", "test");

    const { serverEnv } = await import("./server");
    expect(serverEnv.HYPERCACHE_API_URL).toBe("http://cache:8080");
    expect(serverEnv.HYPERCACHE_MGMT_URL).toBe("http://cache:8081");
    expect(serverEnv.IRON_SESSION_SECRET).toBe(VALID_SECRET);
    // Default applied — schema declares `IRON_SESSION_COOKIE_NAME: ...default("hcm_session")`
    expect(serverEnv.IRON_SESSION_COOKIE_NAME).toBe("hcm_session");
  });

  it("rejects malformed URLs (zod .url())", async () => {
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("HYPERCACHE_API_URL", "not-a-url");
    vi.stubEnv("HYPERCACHE_MGMT_URL", "http://cache:8081");
    vi.stubEnv("IRON_SESSION_SECRET", VALID_SECRET);

    await expect(import("./server")).rejects.toThrow(/HYPERCACHE_API_URL/);
  });
});

describe("env/server OIDC config (Phase C)", () => {
  // Helper: clear AUTH_OIDC_* + AUTH_SECRET from the actual process.env
  // so zod sees them as undefined. vi.stubEnv("X", "") sets X to the
  // empty string, which is a present-but-invalid value for `.url()`
  // and `.min(N)` fields — not equivalent to undefined. Tests that
  // need fields absent must delete them.
  const clearOIDCEnv = () => {
    delete process.env.AUTH_OIDC_ISSUER;
    delete process.env.AUTH_OIDC_CLIENT_ID;
    delete process.env.AUTH_OIDC_CLIENT_SECRET;
    delete process.env.AUTH_OIDC_PROVIDER_NAME;
    delete process.env.AUTH_OIDC_SCOPES;
    delete process.env.AUTH_SECRET;
  };

  it("loads cleanly when no AUTH_OIDC_* vars are set (OIDC disabled is the default)", async () => {
    clearOIDCEnv();
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("HYPERCACHE_API_URL", "http://cache:8080");
    vi.stubEnv("HYPERCACHE_MGMT_URL", "http://cache:8081");
    vi.stubEnv("IRON_SESSION_SECRET", VALID_SECRET);

    const { serverEnv } = await import("./server");
    expect(serverEnv.AUTH_OIDC_ISSUER).toBeUndefined();
    // Defaults applied even when OIDC is disabled — the schema
    // exposes AUTH_OIDC_PROVIDER_NAME as a non-optional default
    // string so callers can read it unconditionally.
    expect(serverEnv.AUTH_OIDC_PROVIDER_NAME).toBe("Identity Provider");
    expect(serverEnv.AUTH_OIDC_SCOPES).toBe("openid profile email");
  });

  it("rejects partial OIDC config (issuer set but client_id missing)", async () => {
    clearOIDCEnv();
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("HYPERCACHE_API_URL", "http://cache:8080");
    vi.stubEnv("HYPERCACHE_MGMT_URL", "http://cache:8081");
    vi.stubEnv("IRON_SESSION_SECRET", VALID_SECRET);
    vi.stubEnv("AUTH_OIDC_ISSUER", "https://idp.example.com");
    // Deliberately omit AUTH_OIDC_CLIENT_ID + SECRET + AUTH_SECRET.

    await expect(import("./server")).rejects.toThrow(/AUTH_OIDC_CLIENT_ID/);
  });

  it("rejects partial OIDC config (issuer + client_id, missing client_secret)", async () => {
    clearOIDCEnv();
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("HYPERCACHE_API_URL", "http://cache:8080");
    vi.stubEnv("HYPERCACHE_MGMT_URL", "http://cache:8081");
    vi.stubEnv("IRON_SESSION_SECRET", VALID_SECRET);
    vi.stubEnv("AUTH_OIDC_ISSUER", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "client-abc");
    vi.stubEnv("AUTH_SECRET", VALID_SECRET);

    await expect(import("./server")).rejects.toThrow(/AUTH_OIDC_CLIENT_SECRET/);
  });

  it("rejects when AUTH_SECRET is too short (zod min(32))", async () => {
    clearOIDCEnv();
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("HYPERCACHE_API_URL", "http://cache:8080");
    vi.stubEnv("HYPERCACHE_MGMT_URL", "http://cache:8081");
    vi.stubEnv("IRON_SESSION_SECRET", VALID_SECRET);
    vi.stubEnv("AUTH_OIDC_ISSUER", "https://idp.example.com");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "client-abc");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "client-secret-xyz");
    vi.stubEnv("AUTH_SECRET", "too-short");

    await expect(import("./server")).rejects.toThrow(/AUTH_SECRET/);
  });

  it("loads cleanly with full OIDC config", async () => {
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

    const { serverEnv } = await import("./server");
    expect(serverEnv.AUTH_OIDC_ISSUER).toBe("https://idp.example.com");
    expect(serverEnv.AUTH_OIDC_CLIENT_ID).toBe("client-abc");
    expect(serverEnv.AUTH_OIDC_CLIENT_SECRET).toBe("client-secret-xyz");
    expect(serverEnv.AUTH_OIDC_PROVIDER_NAME).toBe("Acme SSO");
    expect(serverEnv.AUTH_OIDC_SCOPES).toBe(
      "openid profile email cache_scopes",
    );
    expect(serverEnv.AUTH_SECRET).toBe(VALID_SECRET);
  });

  it("rejects malformed AUTH_OIDC_ISSUER (zod .url())", async () => {
    clearOIDCEnv();
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("HYPERCACHE_API_URL", "http://cache:8080");
    vi.stubEnv("HYPERCACHE_MGMT_URL", "http://cache:8081");
    vi.stubEnv("IRON_SESSION_SECRET", VALID_SECRET);
    vi.stubEnv("AUTH_OIDC_ISSUER", "not-a-url");
    vi.stubEnv("AUTH_OIDC_CLIENT_ID", "client-abc");
    vi.stubEnv("AUTH_OIDC_CLIENT_SECRET", "client-secret-xyz");
    vi.stubEnv("AUTH_SECRET", VALID_SECRET);

    await expect(import("./server")).rejects.toThrow(/AUTH_OIDC_ISSUER/);
  });
});

describe("env/server build phase", () => {
  it("skips validation when NEXT_PHASE=phase-production-build, even with empty env", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("HYPERCACHE_API_URL", "");
    vi.stubEnv("HYPERCACHE_MGMT_URL", "");
    vi.stubEnv("IRON_SESSION_SECRET", "");

    // No throw → page-data collection inside `next build` proceeds.
    // The exported `serverEnv` is process.env cast to the schema
    // type; runtime processes re-evaluate this module with real
    // env, so this build-time looseness doesn't reach production.
    await expect(import("./server")).resolves.toBeDefined();
  });

  it("does not skip validation for unrelated NEXT_PHASE values (e.g. phase-production-server)", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    vi.stubEnv("HYPERCACHE_API_URL", "");
    vi.stubEnv("HYPERCACHE_MGMT_URL", "");
    vi.stubEnv("IRON_SESSION_SECRET", "");

    await expect(import("./server")).rejects.toThrow(
      /Invalid environment for hypercache-monitor/,
    );
  });
});
