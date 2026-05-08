import type { Server } from "node:http";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

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
 *   GET /config                 — metrics: capacity card
 *   GET /stats                  — metrics: per-name stats table
 *   GET /dist/metrics           — metrics: distributed counters
 *   POST /v1/cache/batch/get    — bulk: multi-key fetch
 *   POST /v1/cache/batch/put    — bulk: CSV import
 *   POST /v1/cache/batch/delete — bulk: bulk delete
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

// Monotonically increasing on each /dist/metrics call. Drives
// non-zero deltas in the metrics dashboard sparklines without
// any timing tricks in the E2E itself.
let distMetricsCalls = 0;

function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const auth = req.headers["authorization"];
  const requireAuth = url.pathname !== "/v1/openapi.yaml";

  if (requireAuth && auth !== `Bearer ${STUB_VALID_TOKEN}`) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid token", code: "UNAUTHORIZED" }));
    return;
  }

  // /dist/metrics is dynamic — counters increment on every
  // call so the Phase B2 dashboard's delta-per-sec math has
  // non-zero numbers to render after the second poll.
  if (url.pathname === "/dist/metrics") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(makeDistMetrics(distMetricsCalls++)));
    return;
  }

  // Bulk endpoints. Each operates on the same `keyStore` the
  // single-key handlers use so a Phase B1 PUT is visible to a
  // Phase B3 batch/get without test-coupling between specs.
  if (url.pathname === "/v1/cache/batch/get" && req.method === "POST") {
    handleBatchGet(req, res);
    return;
  }
  if (url.pathname === "/v1/cache/batch/put" && req.method === "POST") {
    handleBatchPut(req, res);
    return;
  }
  if (url.pathname === "/v1/cache/batch/delete" && req.method === "POST") {
    handleBatchDelete(req, res);
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

/**
 * Batch handlers — share `keyStore` with the single-key handlers
 * so a Phase B1 PUT is visible to a Phase B3 batch/get.
 *
 * Per-item granularity matches the Go server: the batch as a
 * whole is 200 unless the request didn't parse; missing /
 * empty-key items produce typed per-item failures rather than
 * voiding the rest of the batch.
 */
function handleBatchGet(req: IncomingMessage, res: ServerResponse): void {
  collectBody(req)
    .then((body) => {
      const parsed = parseJson(body) as { keys?: string[] } | null;
      if (parsed === null || !Array.isArray(parsed.keys)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON: keys[] required", code: "BAD_REQUEST" }));
        return;
      }
      const results = parsed.keys.map((key) => {
        if (key === "") return { key, found: false };
        const entry = keyStore.get(key);
        if (entry === undefined) return { key, found: false };
        return {
          key,
          found: true,
          value: entry.bytes.toString("base64"),
          value_encoding: "base64",
          ...(entry.ttlMs !== undefined ? { ttl_ms: entry.ttlMs } : {}),
          version: 1,
          owners: ["node-1", "node-2", "node-3"],
        };
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ results, node: "node-1" }));
    })
    .catch(() => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal", code: "INTERNAL" }));
    });
}

function handleBatchPut(req: IncomingMessage, res: ServerResponse): void {
  collectBody(req)
    .then((body) => {
      const parsed = parseJson(body) as {
        items?: Array<{ key?: string; value?: string; value_encoding?: string; ttl_ms?: number }>;
      } | null;
      if (parsed === null || !Array.isArray(parsed.items)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON: items[] required", code: "BAD_REQUEST" }));
        return;
      }
      const results = parsed.items.map((item) => {
        if (!item.key || item.key === "") {
          return { key: item.key ?? "", stored: false, error: "missing key", code: "BAD_REQUEST" };
        }
        const valueStr = item.value ?? "";
        let bytes: Buffer;
        if (item.value_encoding === "base64") {
          try {
            bytes = Buffer.from(valueStr, "base64");
          } catch {
            return { key: item.key, stored: false, error: "invalid base64", code: "BAD_REQUEST" };
          }
        } else {
          bytes = Buffer.from(valueStr, "utf-8");
        }
        keyStore.set(item.key, item.ttl_ms !== undefined ? { bytes, ttlMs: item.ttl_ms } : { bytes });
        return { key: item.key, stored: true, bytes: bytes.length, owners: ["node-1", "node-2", "node-3"] };
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ results, node: "node-1" }));
    })
    .catch(() => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal", code: "INTERNAL" }));
    });
}

function handleBatchDelete(req: IncomingMessage, res: ServerResponse): void {
  collectBody(req)
    .then((body) => {
      const parsed = parseJson(body) as { keys?: string[] } | null;
      if (parsed === null || !Array.isArray(parsed.keys)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid JSON: keys[] required", code: "BAD_REQUEST" }));
        return;
      }
      const results = parsed.keys.map((key) => {
        if (key === "") {
          return { key, deleted: false, error: "missing key", code: "BAD_REQUEST" };
        }
        keyStore.delete(key);
        return { key, deleted: true, owners: ["node-1", "node-2", "node-3"] };
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ results, node: "node-1" }));
    })
    .catch(() => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal", code: "INTERNAL" }));
    });
}

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf-8"));
  } catch {
    return null;
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
    // Minimal but realistic — covers the Phase B4 Auth Posture
    // page (securitySchemes) and Phase B5 Spec Viewer (paths
    // entries with one read + one write so the read-only filter
    // has something to drop). Mirrors the production cache's
    // shape closely enough that a regression in the filter or
    // in Scalar's parser would surface here.
    body: [
      "openapi: 3.1.0",
      "info:",
      "  title: HyperCache (stub)",
      "  version: 0.0.0-stub",
      "  description: E2E stub for the monitor's Auth Posture and Spec Viewer surfaces.",
      "paths:",
      "  /v1/cache/{key}:",
      "    get:",
      "      summary: Fetch a key's value and metadata.",
      "      operationId: getCacheKey",
      "      tags: [cache]",
      "      parameters:",
      "        - name: key",
      "          in: path",
      "          required: true",
      "          schema: { type: string }",
      "      responses:",
      "        '200': { description: 'Found.' }",
      "        '404': { description: 'Not found.' }",
      "    delete:",
      "      summary: Delete a key from the cluster.",
      "      operationId: deleteCacheKey",
      "      tags: [cache]",
      "      parameters:",
      "        - name: key",
      "          in: path",
      "          required: true",
      "          schema: { type: string }",
      "      responses:",
      "        '200': { description: 'Deleted.' }",
      "components:",
      "  securitySchemes:",
      "    bearerAuth:",
      "      type: http",
      "      scheme: bearer",
      "      bearerFormat: opaque-token",
      "      description: Bearer token; constant-time compared on the server.",
      "",
    ].join("\n"),
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
  "/config": {
    contentType: "application/json",
    body: JSON.stringify({
      capacity: 100_000,
      allocation: 7_321,
      maxCacheSize: 256 * 1024 * 1024,
      evictionInterval: "30s",
      expirationInterval: "5m0s",
      evictionAlgorithm: "lru",
      replication: 3,
      virtualNodesPerNode: 64,
    }),
  },
  "/stats": {
    contentType: "application/json",
    body: JSON.stringify({
      "cache.get": { Mean: 1.42, Median: 1, Min: 0, Max: 12, Count: 4_521, Sum: 6_419, Variance: 0.85 },
      "cache.set": { Mean: 2.05, Median: 2, Min: 1, Max: 18, Count: 1_207, Sum: 2_474, Variance: 1.21 },
    }),
  },
};

/**
 * Synthesises a `DistMetrics` snapshot whose counters grow
 * with `n` (the call index). Two consecutive calls produce
 * different values, which is what the Phase B2 ring buffer
 * needs to compute non-zero rates. Field shapes match
 * `pkg/backend/dist_memory.go::DistMetrics` exactly so the
 * UI's zod schema parses them without additions.
 */
function makeDistMetrics(n: number) {
  const k = n + 1;
  return {
    ForwardGet: 1000 * k,
    ForwardSet: 500 * k,
    ForwardRemove: 50 * k,
    ReplicaFanoutSet: 1500 * k,
    ReplicaFanoutRemove: 150 * k,
    ReplicaGetMiss: 5 * k,
    ReadRepair: 3 * k,
    HeartbeatSuccess: 5000 * k,
    HeartbeatFailure: 12,
    IndirectProbeSuccess: 4 * k,
    IndirectProbeFailure: 1,
    IndirectProbeRefuted: 0,
    WriteAcks: 800 * k,
    WriteAttempts: 800 * k + 5,
    WriteQuorumFailures: 5,
    Drains: 0,
    NodesSuspect: 1,
    NodesDead: 0,
    NodesRemoved: 0,
    VersionConflicts: 7,
    VersionTieBreaks: 2,
    ReadPrimaryPromote: 1,
    MembershipVersion: 42,
    MembersAlive: 4,
    MembersSuspect: 1,
    MembersDead: 0,
    HintedQueued: 30 * k,
    HintedReplayed: 25 * k,
    HintedExpired: 0,
    HintedDropped: 1,
    HintedGlobalDropped: 0,
    HintedBytes: 4096 * k,
    MerkleSyncs: 10 * k,
    MerkleKeysPulled: 8 * k,
    MerkleBuildNanos: 1_500_000,
    MerkleDiffNanos: 800_000,
    MerkleFetchNanos: 2_000_000,
    AutoSyncLoops: 50 * k,
    LastAutoSyncNanos: 5_000_000,
    LastAutoSyncError: "",
    TombstonesActive: 12,
    TombstonesPurged: 88 * k,
    RebalancedKeys: 100 * k,
    RebalanceBatches: 5 * k,
    RebalanceThrottle: 1,
    RebalanceLastNanos: 1_500_000,
    RebalancedReplicaDiff: 30 * k,
    RebalanceReplicaDiffThrottle: 0,
    RebalancedPrimary: 70 * k,
  };
}
