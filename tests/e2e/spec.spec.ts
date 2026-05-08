import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { STUB_VALID_TOKEN } from "./fixtures/cache-stub";

/**
 * Phase B5 — Live Spec Viewer E2E. Verifies:
 *
 *   - The page renders the OpenAPI spec via the native shadcn
 *     renderer (replaced an earlier @scalar/api-reference-react
 *     integration; see spec-viewer.tsx for the rationale).
 *   - The read-only-method filter holds: GET /v1/cache/{key}
 *     surfaces, DELETE /v1/cache/{key} does NOT (the stub
 *     fixture in cache-stub.ts has both — the page-level
 *     `filterToSafeMethods` drops the DELETE before render).
 *   - axe-core finds no violations on the spec view (the
 *     native renderer is built from the same shadcn primitives
 *     as the rest of the monitor, so the standard
 *     `color-contrast` exception is the only one needed).
 *
 * Selector strategy: anchor on the operation summary text from
 * the stub spec ("Fetch a key's value and metadata.") rendered
 * as a CardTitle (h3). The native renderer's DOM is small +
 * stable, no cross-component disambiguation needed.
 */

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Token").fill(STUB_VALID_TOKEN);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/topology/, { timeout: 10_000 });
}

test.describe("api spec viewer", () => {
  test("renders the spec with read-only methods only", async ({ page }) => {
    await login(page);
    await page.goto("/spec");

    // Page heading
    await expect(page.getByRole("heading", { name: "API spec", level: 1 })).toBeVisible();

    // GET operation surfaces (read-method, kept by the filter).
    await expect(page.getByRole("heading", { name: "Fetch a key's value and metadata." })).toBeVisible();

    // Method badge for the GET operation
    await expect(page.getByText("get", { exact: true })).toBeVisible();

    // The path is rendered as a `<code>` element
    await expect(page.getByText("/v1/cache/{key}", { exact: true })).toBeVisible();

    // DELETE operation must NOT render — filterToSafeMethods
    // dropped it before reaching the renderer.
    await expect(page.getByText("Delete a key from the cluster.")).toHaveCount(0);
  });

  test("a11y: no axe-core violations on /spec", async ({ page }) => {
    await login(page);
    await page.goto("/spec");
    await expect(page.getByRole("heading", { name: "Fetch a key's value and metadata." })).toBeVisible();

    // Same `color-contrast` disable as topology / metrics / bulk
    // for the dark-theme rationale documented in topology.spec.ts.
    // No third-party renderer to exclude — the spec page is now
    // built from the same shadcn primitives as everything else.
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    expect(axe.violations).toEqual([]);
  });
});
