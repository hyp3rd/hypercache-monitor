import { expect, test, type Page } from "@playwright/test";
import {
  STUB_IDENTITY_A,
  STUB_IDENTITY_B,
  STUB_VALID_TOKEN,
} from "./fixtures/cache-stub";

/**
 * Phase C2 multi-cluster end-to-end. Drives the full cross-cluster
 * flow that Phase C1 lit up but couldn't cover with a single-stub
 * fixture:
 *
 *   1. Login on cluster `default` (stub-A) — topbar shows "stub-A"
 *      (the /v1/me payload from the first stub).
 *   2. Open the cluster picker — cluster "secondary" appears under
 *      "Other clusters".
 *   3. Click `secondary` — server returns 401 NEED_LOGIN (no
 *      session bound for that cluster yet); client redirects to
 *      `/login?cluster=secondary` with the dropdown preselected.
 *   4. Login on `secondary` (stub-B) — topbar flips to "stub-B".
 *   5. Open picker, click `default` — no redirect this time
 *      (session has both clusters bound), just an in-place refresh;
 *      topbar flips back to "stub-A".
 *   6. Logout — wipes BOTH cluster sessions (current logout
 *      destroys the whole session; per-cluster logout is a
 *      deliberate non-goal for Phase C2).
 *
 * Why two distinguishable identities (stub-A / stub-B): the topbar
 * renders `auth.session.identity`, sealed at login from the
 * cache's /v1/me response. Two stubs returning the same identity
 * would make the cluster-flip invisible in the DOM.
 *
 * Axe-core coverage of the picker dropdown is intentionally NOT
 * here. Radix's open `DropdownMenu` applies `aria-hidden=true` to
 * the sibling subtree to create the modal effect, but that subtree
 * still contains tabbable links — axe's `aria-hidden-focus` rule
 * flags this as a serious violation. It's a Radix-internals issue,
 * not something we own; topology.spec.ts already exercises axe on
 * the closed state of the same shell, which is what we can fix.
 */

async function loginOnActiveCluster(page: Page) {
  // Caller has navigated to /login?cluster=<id> already. Token
  // input + submit are the same shape as every other spec; the
  // active cluster id rides along via the form's preselected
  // dropdown value.
  await page.getByLabel("Token").fill(STUB_VALID_TOKEN);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/topology/, { timeout: 10_000 });
}

test.describe("multi-cluster picker", () => {
  test("login → switch (NEED_LOGIN) → login other → switch back", async ({
    page,
  }) => {
    // 1. Login on the default cluster.
    await page.goto("/login");
    await loginOnActiveCluster(page);

    // Topbar identity reflects stub-A's /v1/me reply.
    const topbarIdentity = page
      .locator("header")
      .getByText(STUB_IDENTITY_A, { exact: true });
    await expect(topbarIdentity).toBeVisible();

    // 2. Open the cluster picker. The trigger is the topbar
    //    button that bundles the "Cluster" label + active cluster
    //    name; clicking it opens the dropdown.
    await page
      .getByRole("button", { name: /cluster default cluster/i })
      .click();

    // "Secondary cluster" appears as an "Other clusters" entry.
    const secondaryItem = page.getByRole("menuitem", {
      name: /secondary cluster/i,
    });
    await expect(secondaryItem).toBeVisible();

    // 3. Click it — no session bound yet → server 401 NEED_LOGIN
    //    → client redirects to /login?cluster=secondary.
    await secondaryItem.click();
    await expect(page).toHaveURL(/\/login\?cluster=secondary/, {
      timeout: 5_000,
    });

    // The login form's <Select> should be preselected to
    // "Secondary cluster" thanks to the ?cluster= query param.
    await expect(
      page.getByRole("combobox", { name: /cluster/i }),
    ).toContainText(/secondary/i);

    // 4. Login on secondary.
    await loginOnActiveCluster(page);
    const topbarIdentityB = page
      .locator("header")
      .getByText(STUB_IDENTITY_B, { exact: true });
    await expect(topbarIdentityB).toBeVisible();

    // 5. Open picker again, switch back to default. Session has
    //    BOTH clusters bound now, so this is an in-place refresh
    //    — no redirect to /login.
    await page
      .getByRole("button", { name: /cluster secondary cluster/i })
      .click();
    await page.getByRole("menuitem", { name: /default cluster/i }).click();
    await expect(page).toHaveURL(/\/topology/, { timeout: 5_000 });
    await expect(
      page.locator("header").getByText(STUB_IDENTITY_A, { exact: true }),
    ).toBeVisible();

    // The picker is still open here because cluster-picker.tsx
    // calls `e.preventDefault()` on `onSelect` (so the spinner
    // stays visible during the switch). Close it before logout —
    // Radix traps focus in the open menu and the sign-out button
    // would otherwise be unreachable.
    await page.keyboard.press("Escape");

    // 6. Logout wipes both cluster sessions. Returning to
    //    /login should NOT show a "logged-in elsewhere" banner
    //    or any sticky state from the prior cluster.
    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });
});
