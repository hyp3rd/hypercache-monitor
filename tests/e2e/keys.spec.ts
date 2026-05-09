import { expect, test } from "@playwright/test";
import { STUB_VALID_TOKEN } from "./fixtures/cache-stub";

/**
 * Single-Key Inspector E2E. Walks the full PUT → GET → DELETE
 * cycle through the proxy + auth shell. The cache stub is
 * stateful within a run, so the order matters: we PUT first,
 * then assert GET surfaces the value, then DELETE returns the
 * empty state.
 *
 * a11y / dark-theme axe coverage already runs in
 * `topology.spec.ts`; this spec focuses on functional flow,
 * not WCAG repeats.
 *
 * Toasts are intentionally NOT asserted — sonner auto-dismisses
 * on a timer, which makes the assertion racy in headless. We
 * pin persisted state instead (URL, rendered value, dialog
 * presence) since that's what the operator actually relies on.
 */

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Token").fill(STUB_VALID_TOKEN);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/topology/, { timeout: 10_000 });
}

test.describe("single-key inspector", () => {
  test("missing key shows the create-form fallback", async ({ page }) => {
    await login(page);
    await page.goto("/keys?k=does-not-exist-yet");

    // The detail card surfaces a "Not found" description and a
    // pre-filled form (initialBody="") for create.
    await expect(page.getByText(/not found/i)).toBeVisible();
    await expect(page.getByLabel(/value/i)).toBeVisible();
  });

  test("PUT → GET → DELETE round trip", async ({ page }) => {
    await login(page);
    const keyName = `e2e-roundtrip-${Date.now()}`;

    // 1. Navigate to the key (not-found create-form path).
    await page.goto(`/keys?k=${keyName}`);
    await expect(page.getByText(/not found/i)).toBeVisible();

    // 2. Fill value + TTL, Store. The detail view re-fetches
    //    and flips to read mode (Text tab default).
    await page.getByLabel(/value/i).fill("hello world");
    await page.getByLabel(/TTL/i).fill("5m");
    await page.getByRole("button", { name: /store/i }).click();

    // After re-fetch, the populated tabpanel surfaces the
    // stored value.
    await expect(
      page.getByRole("tabpanel").getByText("hello world", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    // 3. Switch to Hex tab — sanity check the decode works.
    await page.getByRole("tab", { name: /hex/i }).click();
    await expect(
      page.getByText("68 65 6c 6c 6f 20 77 6f 72 6c 64", { exact: false }),
    ).toBeVisible();

    // 4. Delete via confirmation dialog. The trigger and the
    //    confirm action both have `name: "Delete"`; scope by
    //    role to disambiguate.
    await page
      .getByRole("button", { name: /^delete$/i })
      .first()
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /^delete$/i })
      .click();

    // Dialog dismissed → URL clears the search param OR the
    // empty-state card renders. Either way we shouldn't see
    // the previously-rendered value.
    await expect(page.getByText("hello world")).not.toBeVisible({
      timeout: 5_000,
    });
  });
});
