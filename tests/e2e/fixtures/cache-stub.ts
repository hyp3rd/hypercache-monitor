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

// In-memory store for keys written during a test run.
// Reset between runs implicitly because globalSetup spawns a
// fresh stub. Tests share a single stub so writes from one
// test are visible to the next — preserve that ordering when
// composing scenarios.
const keyStore = new Map<string, { bytes: Buffer; ttlMs?: number }>();

function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const auth = req.headers["authorization"];
  const requireAuth = url.pathname !== "/v1/openapi.yaml";

  if (requireAuth && auth !== `Bearer ${STUB_VALID_TOKEN}`) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid token", code: "UNAUTHORIZED" }));
    return;
  }

  // Single-key endpoints — handled dynamically. Match
  // /v1/cache/{key} and /v1/owners/{key} before falling
  // through to the static fixture table.
  const cacheMatch = url.pathname.match(/^\/v1\/cache\/(.+)$/);
  if (cacheMatch) {
    handleCacheKey(req, res, decodeURIComponent(cacheMatch[1] ?? ""), url);
    return;
  }
  const ownersMatch = url.pathname.match(/^\/v1\/owners\/(.+)$/);
  if (ownersMatch) {
    const key = decodeURIComponent(ownersMatch[1] ?? "");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ key, owners: ["node-1", "node-2", "node-3"], node: "node-1" }));
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

/**
 * Single-key endpoint handler — supports GET (envelope only,
 * the Accept: application/json path), HEAD, PUT, DELETE.
 */
function handleCacheKey(req: IncomingMessage, res: ServerResponse, key: string, url: URL): void {
  switch (req.method) {
    case "GET": {
      const entry = keyStore.get(key);
      if (entry === undefined) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found", code: "NOT_FOUND" }));
        return;
      }
      const envelope = {
        key,
        value: entry.bytes.toString("base64"),
        value_encoding: "base64",
        ...(entry.ttlMs !== undefined ? { ttl_ms: entry.ttlMs } : {}),
        version: 1,
        node: "node-1",
        owners: ["node-1", "node-2", "node-3"],
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(envelope));
      return;
    }
    case "HEAD": {
      const entry = keyStore.get(key);
      if (entry === undefined) {
        res.writeHead(404);
        res.end();
        return;
      }
      const headers: Record<string, string> = {
        "x-cache-version": "1",
        "x-cache-owners": "node-1,node-2,node-3",
        "x-cache-node": "node-1",
      };
      if (entry.ttlMs !== undefined) headers["x-cache-ttl-ms"] = String(entry.ttlMs);
      res.writeHead(200, headers);
      res.end();
      return;
    }
    case "PUT": {
      const ttl = url.searchParams.get("ttl");
      const ttlMs = ttl !== null ? parseGoDurationMs(ttl) : undefined;
      collectBody(req).then((body) => {
        keyStore.set(key, ttlMs !== undefined ? { bytes: body, ttlMs } : { bytes: body });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            key,
            stored: true,
            ...(ttlMs !== undefined ? { ttl_ms: ttlMs } : {}),
            bytes: body.length,
            node: "node-1",
            owners: ["node-1", "node-2", "node-3"],
          }),
        );
      });
      return;
    }
    case "DELETE": {
      keyStore.delete(key);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          key,
          deleted: true,
          node: "node-1",
          owners: ["node-1", "node-2", "node-3"],
        }),
      );
      return;
    }
    default:
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "method not allowed", code: "METHOD_NOT_ALLOWED" }));
  }
}

function collectBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Tiny Go-duration parser — handles the common suffixes
 * (`ns`, `us`/`µs`, `ms`, `s`, `m`, `h`). The cache itself
 * uses Go's `time.ParseDuration` which is more permissive
 * (compound durations like `1h30m`) but the Phase B1 test
 * only sends single-unit values.
 */
function parseGoDurationMs(s: string): number | undefined {
  const match = s.trim().match(/^([0-9]+(?:\.[0-9]+)?)(ns|us|µs|ms|s|m|h)$/);
  if (!match) return undefined;
  const n = Number(match[1]);
  switch (match[2]) {
    case "ns":
      return n / 1e6;
    case "us":
    case "µs":
      return n / 1000;
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    default:
      return undefined;
  }
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
