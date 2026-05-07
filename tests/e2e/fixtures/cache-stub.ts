import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Server } from "node:http";

/**
 * Tiny stand-in for a HyperCache cluster. Used by Playwright's
 * globalSetup so the E2E suite is hermetic — no Docker, no
 * cache binary, no flaky network dependency.
 *
 * Endpoints served:
 *   GET /v1/openapi.yaml        — login probe (any 200 body)
 *   GET /v1/owners/__probe__    — auth probe (read-scope check)
 *   GET /cluster/members        — topology members table
 *   GET /cluster/ring           — topology hash ring viz
 *   GET /cluster/heartbeat      — topology heartbeat stats
 *
 * Auth: any non-`/v1/openapi.yaml` route requires
 * `Authorization: Bearer <STUB_VALID_TOKEN>`. Mismatched tokens
 * 401 — used by the bad-token scenario.
 *
 * Fixed ports rationale: Playwright's webServer block runs as a
 * child process and inherits env at spawn time, so process.env
 * mutations from globalSetup don't propagate. Pinning ports lets
 * `playwright.config.ts` set HYPERCACHE_*_URL via webServer.env
 * to constants the stub also binds to.
 */

export const STUB_VALID_TOKEN = "valid-stub-token";
export const STUB_API_PORT = 3401;
export const STUB_MGMT_PORT = 3402;
export const STUB_API_URL = `http://127.0.0.1:${STUB_API_PORT}`;
export const STUB_MGMT_URL = `http://127.0.0.1:${STUB_MGMT_PORT}`;

export interface StubHandle {
  apiUrl: string;
  mgmtUrl: string;
  close: () => Promise<void>;
}

export async function startCacheStub(): Promise<StubHandle> {
  const apiServer = createServer(handle);
  const mgmtServer = createServer(handle);

  await Promise.all([listen(apiServer, STUB_API_PORT), listen(mgmtServer, STUB_MGMT_PORT)]);

  return {
    apiUrl: STUB_API_URL,
    mgmtUrl: STUB_MGMT_URL,
    close: async () => {
      await Promise.all([closeServer(apiServer), closeServer(mgmtServer)]);
    },
  };
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const auth = req.headers["authorization"];
  const requireAuth = url.pathname !== "/v1/openapi.yaml";

  if (requireAuth && auth !== `Bearer ${STUB_VALID_TOKEN}`) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid token", code: "UNAUTHORIZED" }));
    return;
  }

  const fixture = FIXTURES[url.pathname];
  if (fixture === undefined) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found", code: "NOT_FOUND" }));
    return;
  }

  res.writeHead(200, { "content-type": fixture.contentType });
  res.end(fixture.body);
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

const FIXTURES: Record<string, { contentType: string; body: string }> = {
  "/v1/openapi.yaml": {
    contentType: "application/yaml",
    body: "openapi: 3.1.0\ninfo:\n  title: Stub\n  version: 0.1.0\npaths: {}\n",
  },
  "/v1/owners/__probe__": {
    contentType: "application/json",
    body: JSON.stringify({ owners: ["node-1", "node-2", "node-3"] }),
  },
  "/cluster/members": {
    contentType: "application/json",
    body: JSON.stringify({
      replication: 3,
      virtualNodes: 64,
      members: [
        { ID: "node-1", Address: "hypercache-1:7946", State: "alive", Incarnation: 723 },
        { ID: "node-2", Address: "hypercache-2:7946", State: "alive", Incarnation: 723 },
        { ID: "node-3", Address: "hypercache-3:7946", State: "alive", Incarnation: 723 },
        { ID: "node-4", Address: "hypercache-4:7946", State: "alive", Incarnation: 723 },
        { ID: "node-5", Address: "hypercache-5:7946", State: "alive", Incarnation: 1 },
      ],
    }),
  },
  "/cluster/ring": {
    contentType: "application/json",
    body: JSON.stringify({
      count: 6,
      vnodes: ["aaa:node-1", "bbb:node-2", "ccc:node-3", "ddd:node-4", "eee:node-5", "fff:node-1"],
    }),
  },
  "/cluster/heartbeat": {
    contentType: "application/json",
    body: JSON.stringify({
      heartbeatSuccess: 12_345,
      heartbeatFailure: 7,
      nodesRemoved: 0,
      readPrimaryPromote: 2,
    }),
  },
};
