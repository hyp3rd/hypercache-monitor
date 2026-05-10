import { expect, test } from "@playwright/test";

/**
 * Phase C OIDC E2E. Drives the full IdP roundtrip against the
 * in-process oidc-stub:
 *
 *   /login → click "Sign in with Test IdP"
 *     → /api/auth/signin/oidc            (auth.js mount)
 *     → http://localhost:3411/authorize  (oidc-stub)
 *     → http://localhost:3100/api/auth/callback/oidc (auth.js)
 *     → http://localhost:3100/api/auth/oidc-callback (our seal)
 *     → /topology
 *
 * Assertions:
 *   - The OIDC button renders (env-gated visibility).
 *   - The post-roundtrip URL is /topology — confirming
 *     iron-session was sealed and the operator is past the
 *     auth shell.
 *   - The cache stub's identity ("stub-A") surfaces in the
 *     topbar, proving /v1/me was probed with the access_token
 *     auth.js issued. (The OIDC stub's IDENTITY claim is
 *     overridden by the cache stub's hardcoded /v1/me reply —
 *     in production the cache verifies the JWT and returns the
 *     IdP's `sub`; here we cap the assertion at "the seal
 *     happened with whatever the cache returned.")
 *   - Logout via /api/auth/logout clears both cookies.
 *
 * The existing static-bearer specs (topology, multi-cluster,
 * admin, keys, bulk, metrics, auth-info, spec) continue to use
 * the paste-token path — proving the hybrid coexistence claim.
 */

test.describe("Phase C OIDC", () => {
  test("login button renders when AUTH_OIDC_ISSUER is configured", async ({
    page,
  }) => {
    await page.goto("/login");
    // The button label uses the env-driven provider name.
    await expect(
      page.getByRole("button", { name: /Sign in with Test IdP/i }),
    ).toBeVisible();
    // The static-bearer form is still present — hybrid coexistence.
    await expect(page.getByLabel("Token")).toBeVisible();
  });

  test("full IdP roundtrip seals iron-session and lands on /topology", async ({
    page,
  }) => {
    await page.goto("/login");
    // Top-level nav to /api/auth/signin/oidc (auth.js's mount).
    // Auth.js redirects to the IdP, the IdP redirects back, the
    // post-callback handler seals iron-session, and we land on
    // /topology. The whole roundtrip should complete in well under
    // 10s on the in-process stub.
    await Promise.all([
      page.waitForURL(/\/topology/, { timeout: 10_000 }),
      page.getByRole("button", { name: /Sign in with Test IdP/i }).click(),
    ]);
    // The topbar surfaces whatever identity the cache's /v1/me
    // returned for the issued access_token. The cache stub
    // returns "stub-A" for the default cluster regardless of
    // bearer source; what matters here is that an identity is
    // visible — that means /v1/me was probed (Phase C2 seal)
    // and iron-session held the result.
    await expect(page.getByText("stub-A")).toBeVisible({ timeout: 5_000 });
  });

  test("logout clears the OIDC session and redirects to /login", async ({
    page,
  }) => {
    // Sign in first.
    await page.goto("/login");
    await Promise.all([
      page.waitForURL(/\/topology/, { timeout: 10_000 }),
      page.getByRole("button", { name: /Sign in with Test IdP/i }).click(),
    ]);
    await expect(page.getByText("stub-A")).toBeVisible({ timeout: 5_000 });

    // Whole-session logout via the API. Cookie-clearing happens
    // in the response Set-Cookie headers; the next /topology hit
    // 401s and the proxy redirects to /login.
    const res = await page.request.post("/api/auth/logout");
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, mode: "all" });

    // After logout the protected page bounces back to /login —
    // both cookies are cleared (iron-session AND auth.js).
    await page.goto("/topology");
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });
});
