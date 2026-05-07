import { defineConfig, devices } from "@playwright/test";
import { STUB_API_URL, STUB_MGMT_URL } from "./tests/e2e/fixtures/cache-stub";

// Playwright runs the full app against `next dev` (or a built
// production server in CI). The webServer block boots Next; the
// E2E tests then drive a real browser through the proxy and the
// auth shell. Test files live under `tests/e2e/` to keep them
// outside of `src/` (Vitest's include scope).
//
// Architecture note: webServer is a child process that inherits
// env at spawn time and CANNOT see process.env mutations from
// globalSetup. So we pass HYPERCACHE_API_URL / HYPERCACHE_MGMT_URL
// here explicitly, pinned to the same fixed ports the stub binds
// to (see tests/e2e/fixtures/cache-stub.ts).

// 32-char minimum per src/env/server.ts. Test-only secret —
// regenerated each run is unnecessary because the cookie never
// crosses a process boundary in the test suite.
const TEST_SESSION_SECRET = "playwright-iron-session-secret-not-for-prod-32chars-min";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,

  // Hermetic: globalSetup spins up a node:http stub of the
  // cache (see tests/e2e/fixtures/cache-stub.ts) on
  // STUB_API_PORT / STUB_MGMT_PORT, and webServer below boots
  // Next.js pointed at those URLs.
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",

  // Sequential to avoid port collision on the fixed-port stub.
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: 1,
  reporter: process.env["CI"] ? "github" : "list",

  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: process.env["CI"]
      ? "npm run build && npm run start -- --port 3000 --hostname 127.0.0.1"
      : "npm run dev -- --port 3000 --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
    env: {
      HYPERCACHE_API_URL: STUB_API_URL,
      HYPERCACHE_MGMT_URL: STUB_MGMT_URL,
      IRON_SESSION_SECRET: TEST_SESSION_SECRET,
      NODE_ENV: "test",
    },
  },
});
