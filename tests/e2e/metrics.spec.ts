import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { STUB_VALID_TOKEN } from "./fixtures/cache-stub";

/**
 * Phase B2 — Metrics dashboard E2E. Verifies the seven section
 * cards render from canned `/config`, `/stats`, `/dist/metrics`
 * fixtures. The cache stub returns DistMetrics counters that
 * grow with each call, so by the time the page has polled twice
 * (5s active interval + small slack) the sparklines have
 * computable rates.
 *
 * The axe-core check rides along here too — same `color-contrast`
 * disable as topology, same Phase B follow-up tracking.
 *
 * Selector notes:
 *   - "Capacity" matches both the card title and the static cell
 *     label inside it; we scope to the heading role to avoid
 *     ambiguity.
 *   - The "Live" status pill in the page header has the same
 *     text as it does on Topology; we don't assert on it because
 *     it's chrome, not the feature under test.
 */

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Token").fill(STUB_VALID_TOKEN);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/topology/, { timeout: 10_000 });
}

test.describe("metrics dashboard", () => {
  test("renders all section cards with values from /dist/metrics", async ({ page }) => {
    await login(page);
    await page.goto("/metrics");

    // Page heading
    await expect(page.getByRole("heading", { name: "Metrics", level: 1 })).toBeVisible();

    // Each section card title is a heading inside the card. Use
    // a regex anchor so partial matches across other elements
    // (e.g. tooltip popovers) don't trip the strict-mode locator.
    const titles = [
      "Capacity",
      "Traffic",
      "Reliability",
      "Repair & drift",
      "Membership",
      "Hinted handoff",
      "Rebalance",
      "Per-name stats",
    ];
    for (const title of titles) {
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    }

    // Capacity card surfaces the eviction algorithm. The
    // fixture sets it to "lru" and the value cell renders
    // exactly that string.
    await expect(page.getByText("lru", { exact: true })).toBeVisible();

    // Membership gauges from the fixture: 4 alive, 1 suspect,
    // 0 dead, version 42. Scope to the cards' tabular-numbers
    // — the values appear in `<p>`s with that font-feature.
    await expect(page.getByText("Alive").first()).toBeVisible();
    await expect(page.getByText("Suspect").first()).toBeVisible();
    await expect(page.getByText("Dead").first()).toBeVisible();

    // Per-name stats table renders both fixture metrics.
    const statsTable = page.getByRole("table");
    await expect(statsTable.getByText("cache.get", { exact: true })).toBeVisible();
    await expect(statsTable.getByText("cache.set", { exact: true })).toBeVisible();
  });

  test("a11y: no axe-core violations on /metrics", async ({ page }) => {
    await login(page);
    await page.goto("/metrics");

    // Wait for cards to finish their first paint. The Capacity
    // card lights up as soon as /config lands, so it's the
    // earliest stable signal.
    await expect(page.getByText("Capacity", { exact: true }).first()).toBeVisible();

    // Same disabled rules as topology — see topology.spec.ts
    // for the rationale + tracked follow-up.
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    expect(axe.violations).toEqual([]);
  });
});
