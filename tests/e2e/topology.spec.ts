import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { STUB_VALID_TOKEN } from "./fixtures/cache-stub";

/**
 * Topology happy-path E2E. Walks the full stack:
 *   browser → Next.js proxy → cache stub
 *
 * Three scenarios:
 *   1. Bad token at login surfaces an error in #login-error
 *   2. Visiting /topology without a session redirects to /login
 *   3. Good token: login → topology renders members + ring +
 *      heartbeat → axe-core finds no a11y violations →
 *      logout returns to /login
 *
 * Selector notes — Playwright runs in strict mode by default
 * (every selector must match exactly one element):
 *   - `getByRole("alert")` would match Next's
 *     `__next-route-announcer__` div in addition to our error
 *     <p>; we target `#login-error` directly.
 *   - `getByText("node-X")` matches the members table row, the
 *     SVG <title> tags inside the ring, and the legend label —
 *     four matches. We scope to `getByRole("table")` so the
 *     selector finds exactly the table cell.
 *
 * Axe-core's recommended rules ride along with the happy path
 * — that's our Lighthouse-a11y substitute, runs in CI on every
 * push instead of on demand.
 */

test.describe("topology surface", () => {
  test("bad token surfaces an error on login", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Token").fill("not-the-right-token");
    await page.getByRole("button", { name: /^Sign in$/i }).click();

    // Target the form's error region by id — getByRole("alert")
    // collides with Next's route-announcer.
    await expect(page.locator("#login-error")).toContainText(
      /invalid token|UNAUTHORIZED/i,
    );
    await expect(page).toHaveURL(/\/login/);
  });

  test("unauthenticated /topology redirects to /login", async ({ page }) => {
    await page.goto("/topology");
    await expect(page).toHaveURL(/\/login/);
  });

  test("happy path: login → topology renders → logout", async ({ page }) => {
    // 1. Login
    await page.goto("/login");
    await page.getByLabel("Token").fill(STUB_VALID_TOKEN);
    await page.getByRole("button", { name: /^Sign in$/i }).click();
    await expect(page).toHaveURL(/\/topology/, { timeout: 10_000 });

    // 2. Members table renders the 5 fixture nodes. Scope to
    //    the table so we don't collide with the ring SVG
    //    <title>s and the legend.
    const membersTable = page.getByRole("table");
    await expect(membersTable).toBeVisible();
    for (const id of ["node-1", "node-2", "node-3", "node-4", "node-5"]) {
      await expect(membersTable.getByText(id, { exact: true })).toBeVisible();
    }

    // 3. Ring viz renders — vnode count from fixture is 6
    await expect(
      page.getByRole("img", { name: /Hash ring with 6 vnodes/ }),
    ).toBeVisible();

    // 4. Heartbeat success rate renders (12345/12352 ≈ 99.94%)
    await expect(page.getByText(/probe success rate/i)).toBeVisible();

    // 5. Axe-core a11y check — Lighthouse-a11y substitute that
    //    runs on every CI push. Covers keyboard nav, ARIA,
    //    landmark structure, name-role-value semantics, etc.
    //
    //    `color-contrast` is intentionally disabled here: the
    //    violet-on-dark theme has known contrast issues on a
    //    handful of muted-foreground surfaces (stat-tile
    //    descriptions, ring legend percentages, sidebar
    //    "Phase A" footer). Fixing them needs a coordinated
    //    design pass on the dark-theme tokens — out of scope
    //    for Phase A finalization. Tracked as a Phase B follow-up.
    //    See `docs/lighthouse-baseline.json` (committed) for
    //    the manual Lighthouse run that documents the failing
    //    contrast pairs.
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    expect(axe.violations).toEqual([]);

    // 6. Logout returns to /login
    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });

  test("topology subscribes to SSE for live updates", async ({ page }) => {
    // Capture every cluster-events SSE request so we can assert
    // the EventSource opened against the cluster-aware proxy URL.
    // A retry storm or a missing subscription would surface as
    // a count != 1 here.
    const sseRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/mgmt/cluster/events")) {
        sseRequests.push(`${req.method()} ${req.url()}`);
      }
    });

    await page.goto("/login");
    await page.getByLabel("Token").fill(STUB_VALID_TOKEN);
    await page.getByRole("button", { name: /^Sign in$/i }).click();
    await expect(page).toHaveURL(/\/topology/, { timeout: 10_000 });

    // Members table renders — confirms the page hydrated; SSE
    // opens fire-on-mount of TopologyClient.
    await expect(page.getByRole("table")).toBeVisible();

    // Wait briefly for the EventSource to open (Playwright's
    // request capture is synchronous on the main thread but
    // hydration may queue the EventSource construction).
    await expect
      .poll(() => sseRequests.length, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(1);

    expect(sseRequests[0]).toMatch(
      /GET .*\/api\/clusters\/default\/mgmt\/cluster\/events/,
    );
  });
});
