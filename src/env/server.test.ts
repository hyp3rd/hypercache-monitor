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
  it("throws with a multi-issue message when required vars are missing", async () => {
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("HYPERCACHE_API_URL", "");
    vi.stubEnv("HYPERCACHE_MGMT_URL", "");
    vi.stubEnv("IRON_SESSION_SECRET", "");

    await expect(import("./server")).rejects.toThrow(/Invalid environment for hypercache-monitor/);
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

    await expect(import("./server")).rejects.toThrow(/Invalid environment for hypercache-monitor/);
  });
});
