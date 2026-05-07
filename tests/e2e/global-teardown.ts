/**
 * Playwright globalTeardown runs after the suite finishes.
 * Closes the cache stub started in globalSetup so the test
 * runner exits cleanly without leaking node:http servers.
 */
async function globalTeardown(): Promise<void> {
  const stub = globalThis.__cacheStub;
  if (stub) {
    await stub.close();
    globalThis.__cacheStub = undefined;
  }
}

export default globalTeardown;
