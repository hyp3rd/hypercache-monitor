import {
  startCacheStub,
  STUB_API_URL_B,
  STUB_API_PORT_B,
  STUB_IDENTITY_B,
  STUB_MGMT_PORT_B,
  STUB_MGMT_URL_B,
  type StubHandle,
} from "./fixtures/cache-stub";

/**
 * Playwright globalSetup runs once before the test suite.
 *
 * Phase A/B: starts a single in-process cache stub on the fixed
 * ports declared in fixtures/cache-stub.ts.
 *
 * Phase C2: starts a SECOND stub on a different port pair so the
 * multi-cluster spec can drive a real cross-cluster login + switch
 * flow. The temp `clusters.yaml` itself is written at config-load
 * time via the side-effect import in `fixtures/clusters-yaml.ts` —
 * see that module for why writing here would race the webServer's
 * first request.
 *
 * Stash both stubs on `globalThis` so globalTeardown closes them
 * cleanly.
 */

declare global {
  var __cacheStub: StubHandle | undefined;
  var __cacheStubB: StubHandle | undefined;
}

async function globalSetup(): Promise<void> {
  const stubA = await startCacheStub(); // defaults to 3401/3402, identity=stub-A
  const stubB = await startCacheStub({
    apiPort: STUB_API_PORT_B,
    mgmtPort: STUB_MGMT_PORT_B,
    apiUrl: STUB_API_URL_B,
    mgmtUrl: STUB_MGMT_URL_B,
    identity: STUB_IDENTITY_B,
  });

  globalThis.__cacheStub = stubA;
  globalThis.__cacheStubB = stubB;
}

export default globalSetup;
