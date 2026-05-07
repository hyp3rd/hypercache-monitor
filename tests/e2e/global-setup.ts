import { startCacheStub, type StubHandle } from "./fixtures/cache-stub";

/**
 * Playwright globalSetup runs once before the test suite.
 * Single responsibility: start the in-process cache stub on
 * the fixed ports declared in fixtures/cache-stub.ts.
 *
 * Env propagation to the Next.js webServer happens in
 * `playwright.config.ts`'s `webServer.env` (NOT here) — child
 * processes inherit env at spawn time and don't see
 * process.env mutations made after the fact.
 *
 * Stash the stub handle on `globalThis` so globalTeardown
 * (same Node process) can close it cleanly.
 */

declare global {
  var __cacheStub: StubHandle | undefined;
}

async function globalSetup(): Promise<void> {
  const stub = await startCacheStub();
  globalThis.__cacheStub = stub;
}

export default globalSetup;
