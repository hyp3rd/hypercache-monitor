import { defineConfig, devices } from "@playwright/test";
import { CLUSTERS_YAML_PATH } from "./tests/e2e/fixtures/clusters-yaml";
import {
  OIDC_STUB_CLIENT_ID,
  OIDC_STUB_CLIENT_SECRET,
  OIDC_STUB_ISSUER,
} from "./tests/e2e/fixtures/oidc-stub";

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
// Phase C OIDC: separate auth.js JWT secret. 32-char min per
// AUTH_SECRET schema. The oidc-stub signs tokens with its own
// RSA key (generated fresh per run); this secret only signs the
// auth.js session cookie that carries the issued access_token
// over to the post-callback handler.
const TEST_AUTH_SECRET =
  "playwright-auth-js-jwt-secret-not-for-prod-32chars-min";

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
    //
    // Phase C OIDC: switched the baseURL host from 127.0.0.1 to
    // localhost. Auth.js v5 uses the request `Host` header to
    // build the OIDC redirect_uri it sends to the IdP. Some
    // Node.js HTTP layers (including Next.js dev's request
    // normalization) coerce `127.0.0.1` to `localhost` in
    // generated URLs, producing a redirect_uri whose hostname
    // differs from the page's. PKCE/state cookies are host-
    // scoped, so the callback comes in on a different hostname,
    // can't read the cookie, and auth.js 500s the flow with
    // `error=Configuration`. Running E2E on localhost throughout
    // sidesteps the normalization mismatch entirely.
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: process.env["CI"]
      ? "npm run build && npm run start -- --port 3100 --hostname localhost"
      : "npm run dev -- --port 3100 --hostname localhost",
    url: "http://localhost:3100",
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
      // Phase C OIDC: env points at the in-process OIDC stub
      // started by globalSetup. With these set, the login page
      // renders the OIDC button and auth.js's [...nextauth]
      // handler is active.
      //
      // AUTH_URL pins auth.js's canonical URL. Combined with
      // the localhost-everywhere baseURL above, this guarantees
      // the redirect_uri auth.js sends to the IdP matches the
      // page hostname so PKCE/state cookies stay host-scoped
      // through the callback.
      AUTH_URL: "http://localhost:3100",
      AUTH_OIDC_ISSUER: OIDC_STUB_ISSUER,
      AUTH_OIDC_CLIENT_ID: OIDC_STUB_CLIENT_ID,
      AUTH_OIDC_CLIENT_SECRET: OIDC_STUB_CLIENT_SECRET,
      AUTH_OIDC_PROVIDER_NAME: "Test IdP",
      AUTH_OIDC_SCOPES: "openid profile email",
      AUTH_SECRET: TEST_AUTH_SECRET,
    },
  },
});
