import { defineConfig, devices } from "@playwright/test";
import { CLUSTERS_YAML_PATH } from "./tests/e2e/fixtures/clusters-yaml";

// Playwright runs the full app against `next dev` (or a built
// production server in CI). The webServer block boots Next; the
// E2E tests then drive a real browser through the proxy and the
// auth shell. Test files live under `tests/e2e/` to keep them
// outside of `src/` (Vitest's include scope).
//
// Architecture note: webServer is a child process that inherits
// env at spawn time and CANNOT see process.env mutations from
// globalSetup. So we pass HYPERCACHE_MONITOR_CLUSTERS here
// explicitly. globalSetup writes the YAML at CLUSTERS_YAML_PATH
// BEFORE webServer spawns (Playwright runs globalSetup first per
// its docs), so the registry's first read finds a valid file.
//
// Phase C2: switched from the single-cluster URL pair
// (HYPERCACHE_API_URL / HYPERCACHE_MGMT_URL) to the YAML registry.
// The YAML defines two clusters pointing at two stub instances —
// see tests/e2e/global-setup.ts. Existing single-cluster specs
// continue to work because the first cluster id is still "default"
// and the login form auto-selects the first entry.

// 32-char minimum per src/env/server.ts. Test-only secret —
// regenerated each run is unnecessary because the cookie never
// crosses a process boundary in the test suite.
const TEST_SESSION_SECRET =
  "playwright-iron-session-secret-not-for-prod-32chars-min";

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
    // Dedicated test port — keeps the E2E web server isolated
    // from `npm run dev` on :3000, which an operator might be
    // running concurrently for visual review. With Playwright's
    // historic `reuseExistingServer: !CI` setting, hitting :3000
    // would have reused the operator's dev server (wrong env
    // vars, no cache stub) and produced 13/14 silent E2E failures.
    // Decoupling on :3100 makes that class of bug structurally
    // impossible.
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: process.env["CI"]
      ? "npm run build && npm run start -- --port 3100 --hostname 127.0.0.1"
      : "npm run dev -- --port 3100 --hostname 127.0.0.1",
    url: "http://127.0.0.1:3100",
    // Reuse-existing on :3100 is safe — only Playwright itself
    // ever binds that port, so a "reuse" only ever picks up
    // ITS OWN previous instance during fast iteration. No
    // operator dev server can land on :3100 unless they
    // explicitly target it.
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
    env: {
      HYPERCACHE_MONITOR_CLUSTERS: CLUSTERS_YAML_PATH,
      IRON_SESSION_SECRET: TEST_SESSION_SECRET,
      NODE_ENV: "test",
    },
  },
});
