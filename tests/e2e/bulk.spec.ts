import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { STUB_VALID_TOKEN } from "./fixtures/cache-stub";

/**
 * Phase B3 — Bulk operations E2E. Three scenarios chained on
 * a stateful cache stub:
 *
 *   1. Put: upload a tiny CSV (synthesized via DataTransfer to
 *      avoid a temp-file dance) → batch/put → results table
 *      shows "stored" rows
 *   2. Fetch: paste the same keys into the Fetch textarea →
 *      batch/get → results table shows them as "found"
 *   3. Delete: paste the keys into Delete → confirm dialog →
 *      batch/delete → results table shows "deleted"
 *
 * The keyStore is shared across the stub's lifetime, so step 1
 * seeds keys for step 2 and step 3.
 *
 * The axe-core check rides along on the Fetch tab — the layout
 * is the same on all three tabs and rerunning axe per tab is
 * just CI time for no marginal coverage.
 */

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Token").fill(STUB_VALID_TOKEN);
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await expect(page).toHaveURL(/\/topology/, { timeout: 10_000 });
}

test.describe("bulk operations", () => {
  test("put → fetch → delete round trip", async ({ page }) => {
    await login(page);
    await page.goto("/bulk");

    // -- 1. Put ----------------------------------------------------
    // The page defaults to the Fetch tab; switch to Put.
    await page.getByRole("tab", { name: /^Put$/ }).click();

    // Synthesize a CSV file via DataTransfer + setInputFiles. The
    // alternative — writing to /tmp and uploading by path — would
    // depend on Playwright's worker filesystem, which is brittle
    // across CI runners.
    const csvContent = [
      "key,value,ttl_ms",
      `e2e-bulk-1,hello,${30_000}`,
      `e2e-bulk-2,world,${60_000}`,
    ].join("\n");

    await page
      .locator('input[type="file"][aria-label="Upload CSV"]')
      .setInputFiles({
        name: "fixture.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csvContent),
      });

    // CSV parsed → Store button is enabled with the right count.
    // Asserting on the button (not surrounding chrome text) avoids
    // the strict-mode collision between the file-info "2 items"
    // span and the `<details>` "Preview first 2 items" summary.
    const storeBtn = page.getByRole("button", { name: /Store 2/ });
    await expect(storeBtn).toBeEnabled({ timeout: 5_000 });
    await storeBtn.click();

    // Results table should render two "stored" rows
    await expect(page.getByText(/2 results · 2 stored · 0 failed/)).toBeVisible(
      { timeout: 5_000 },
    );

    // -- 2. Fetch --------------------------------------------------
    await page.getByRole("tab", { name: /^Fetch$/ }).click();
    await page.getByLabel("Keys to fetch").fill("e2e-bulk-1\ne2e-bulk-2");
    await page.getByRole("button", { name: /Fetch 2/ }).click();
    await expect(page.getByText(/2 results · 2 found · 0 missing/)).toBeVisible(
      { timeout: 5_000 },
    );

    // The "Download CSV" button surfaces once results land
    await expect(
      page.getByRole("button", { name: /Download CSV/ }),
    ).toBeVisible();

    // -- 3. Delete -------------------------------------------------
    await page.getByRole("tab", { name: /^Delete$/ }).click();
    await page.getByLabel("Keys to delete").fill("e2e-bulk-1\ne2e-bulk-2");
    await page.getByRole("button", { name: /Delete 2/ }).click();

    // Two-step confirmation: dialog with the count
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(
      page.getByRole("alertdialog").getByText(/Delete 2 keys\?/),
    ).toBeVisible();
    await page.getByRole("button", { name: /Confirm delete/ }).click();

    await expect(
      page.getByText(/2 results · 2 deleted · 0 failed/),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("a11y: no axe-core violations on /bulk", async ({ page }) => {
    await login(page);
    await page.goto("/bulk");

    // Wait for the Fetch tab's main heading to anchor first paint.
    await expect(page.getByLabel("Keys to fetch")).toBeVisible();

    // Same disabled rules as topology / metrics — see
    // topology.spec.ts for the rationale + tracked follow-up.
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    expect(axe.violations).toEqual([]);
  });
});
