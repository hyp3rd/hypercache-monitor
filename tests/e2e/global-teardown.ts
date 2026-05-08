import { rmSync } from "node:fs";
import { CLUSTERS_YAML_PATH } from "./fixtures/clusters-yaml";

/**
 * Playwright globalTeardown runs after the suite finishes.
 * Closes both cache stubs started in globalSetup so the test
 * runner exits cleanly, and removes the temp clusters.yaml so
 * subsequent runs of the same suite see a clean tmpdir.
 */
async function globalTeardown(): Promise<void> {
  const closes: Promise<void>[] = [];
  if (globalThis.__cacheStub) {
    closes.push(globalThis.__cacheStub.close());
    globalThis.__cacheStub = undefined;
  }
  if (globalThis.__cacheStubB) {
    closes.push(globalThis.__cacheStubB.close());
    globalThis.__cacheStubB = undefined;
  }
  await Promise.all(closes);

  // force=true keeps teardown idempotent — a second run after a
  // crashed-mid-suite test session must not fail because the
  // file is already gone.
  rmSync(CLUSTERS_YAML_PATH, { force: true });
}

export default globalTeardown;
