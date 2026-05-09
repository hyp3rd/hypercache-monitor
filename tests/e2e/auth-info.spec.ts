import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { STUB_VALID_TOKEN } from "./fixtures/cache-stub";

/**
 * Phase B4 — Auth Posture viewer E2E. Verifies all three cards
 * render from the live session + the stub's OpenAPI spec, and
 * that the bearer token is NOT exposed anywhere on the page
 * (the load-bearing security guarantee for this surface).
 *
 * Selector notes — strict-mode locators:
 *   - "Read"/"Write"/"Admin" appear multiple times (chip + matrix
 *     row); the page-level assertions scope to roles/headings to
 *     avoid the ambiguity.
 */

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Token").fill(STUB_VALID_TOKEN);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/topology/, { timeout: 10_000 });
}

test.describe("auth posture", () => {
  test("renders identity, scopes, and security scheme from live state", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/auth-info");

    await expect(
      page.getByRole("heading", { name: "Auth posture", level: 1 }),
    ).toBeVisible();

    // Identity card
    await expect(
      page.getByText("Session identity", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Active cluster", { exact: true }),
    ).toBeVisible();

    // Scopes card — login probe path grants read+write+admin in
    // the stub session bootstrap (same shape every test uses).
    await expect(
      page.getByText("Granted scopes", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Permissions matrix", { exact: true }),
    ).toBeVisible();

    // Permissions matrix shows "granted" for every scope in the
    // catalog — the stub login grants all three.
    const grantedPills = page.getByText("granted", { exact: true });
    await expect(grantedPills).toHaveCount(3);

    // Server auth scheme card — schemed from the stub's spec
    await expect(
      page.getByText("Server auth scheme", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("bearerAuth", { exact: true })).toBeVisible();
    // type · scheme pill on the bearerAuth row
    await expect(
      page.getByText("http · bearer", { exact: true }),
    ).toBeVisible();
  });

  test("never exposes the bearer token", async ({ page }) => {
    await login(page);
    await page.goto("/auth-info");
    await expect(
      page.getByRole("heading", { name: "Auth posture", level: 1 }),
    ).toBeVisible();

    // Critical security guarantee: the token sealed in the
    // iron-session cookie must NEVER appear in the rendered DOM.
    // Page-text assertion is the right shape here — even a masked
    // disclosure would surface partial substrings of the token.
    const text = await page.textContent("body");
    expect(text ?? "").not.toContain(STUB_VALID_TOKEN);
  });

  test("a11y: no axe-core violations on /auth-info", async ({ page }) => {
    await login(page);
    await page.goto("/auth-info");
    await expect(
      page.getByText("Session identity", { exact: true }),
    ).toBeVisible();

    // Same disabled rules as topology / metrics / bulk —
    // documented under topology.spec.ts (color-contrast deferred).
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    expect(axe.violations).toEqual([]);
  });
});
