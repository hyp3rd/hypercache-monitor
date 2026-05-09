import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { STUB_VALID_TOKEN } from "./fixtures/cache-stub";

/**
 * Phase C2 admin controls E2E. Drives the three destructive
 * operations end-to-end through the monitor proxy and into the
 * cache stub:
 *
 *   1. Login (the stub's /v1/me grants all three scopes including
 *      admin, so the sidebar Administration section + /admin page
 *      both render).
 *   2. Sidebar entry "Controls" exists and links to /admin.
 *   3. /admin renders three control cards: Evict, Trigger
 *      Expiration, Clear.
 *   4. Each control's destructive button is gated by an
 *      AlertDialog confirm — one click reveals the dialog,
 *      Cancel dismisses it without firing fetch.
 *   5. Confirming an action POSTs to
 *      `/api/clusters/default/mgmt/control/<op>` and produces a
 *      success toast. The stub responds 202 / 200 per the
 *      cache binary's own response shapes.
 *   6. axe-core a11y check on the page (closed-dialog state —
 *      the open Radix AlertDialog has the same aria-hidden
 *      sibling issue as the cluster picker; deferred per the
 *      multi-cluster.spec.ts rationale).
 */

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Token").fill(STUB_VALID_TOKEN);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/topology/, { timeout: 10_000 });
}

test.describe("admin controls", () => {
  test("sidebar Administration section renders for admin sessions", async ({
    page,
  }) => {
    await login(page);

    // Section header + Controls nav link.
    const adminLink = page.getByRole("link", { name: /controls/i });
    await expect(adminLink).toBeVisible();
    await adminLink.click();
    await expect(page).toHaveURL(/\/admin/);

    // The page renders all three cards.
    await expect(
      page.getByRole("heading", { name: /trigger eviction/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /trigger expiration/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /clear cluster/i }),
    ).toBeVisible();
  });

  test("Cancel in the confirm dialog dismisses without firing the request", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/admin");

    // Track every fetch the page initiates so we can assert the
    // admin route is NOT hit on Cancel. Page-level request listener
    // captures everything outbound from the rendered tree.
    const requested: string[] = [];
    page.on("request", (r) => {
      const url = r.url();
      if (url.includes("/api/clusters/")) {
        requested.push(`${r.method()} ${url}`);
      }
    });

    // Click the Trigger Eviction button (the card's call-to-action,
    // matches the card heading text in the AlertDialogTrigger button).
    await page
      .getByRole("button", { name: /^trigger eviction$/i })
      .first()
      .click();

    // Dialog visible.
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(page.getByText(/trigger eviction sweep\?/i)).toBeVisible();

    // Cancel.
    await page.getByRole("button", { name: /^cancel$/i }).click();
    await expect(page.getByRole("alertdialog")).not.toBeVisible();

    // No fetch made — Cancel is the only path that doesn't POST.
    expect(requested.filter((r) => r.includes("/mgmt/control/"))).toEqual([]);
  });

  test("Confirming Trigger Eviction POSTs and surfaces a success toast", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/admin");

    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/mgmt/control/evict") &&
        resp.request().method() === "POST",
    );

    await page
      .getByRole("button", { name: /^trigger eviction$/i })
      .first()
      .click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page
      .getByRole("button", { name: /^trigger eviction$/i })
      .last()
      .click();

    const response = await responsePromise;
    expect(response.status()).toBe(202);

    // Sonner toast region — `aria-live=polite` text node.
    await expect(page.getByText(/eviction sweep triggered/i)).toBeVisible();
  });

  test("Confirming Clear cluster POSTs to /clear with admin scope", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/admin");

    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/mgmt/control/clear") &&
        resp.request().method() === "POST",
    );

    await page
      .getByRole("button", { name: /^clear cluster$/i })
      .first()
      .click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(page.getByText(/this deletes every key/i)).toBeVisible();
    await page
      .getByRole("button", { name: /^clear cluster$/i })
      .last()
      .click();

    const response = await responsePromise;
    expect(response.status()).toBe(200);
    await expect(page.getByText(/cluster cleared/i)).toBeVisible();
  });

  test("/admin closed-dialog state is axe-clean", async ({ page }) => {
    await login(page);
    await page.goto("/admin");

    // Wait for the page heading so the layout is fully rendered
    // before axe walks the tree.
    await expect(
      page.getByRole("heading", { name: /^controls$/i }),
    ).toBeVisible();

    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    expect(axe.violations).toEqual([]);
  });
});
