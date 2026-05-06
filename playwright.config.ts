import { defineConfig, devices } from "@playwright/test";

// Playwright runs the full app against `next dev` (or a built
// production server in CI). The webServer block boots Next; the
// E2E tests then drive a real browser through the proxy and the
// auth shell. Test files live under `tests/e2e/` to keep them
// outside of `src/` (Vitest's include scope).

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: process.env["CI"] ? 1 : undefined,
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
  },
});
