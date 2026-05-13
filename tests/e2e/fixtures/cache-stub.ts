import type { Server } from "node:http";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

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

// Phase C2: two stub instances live in parallel during the E2E
// suite — the first matches the existing single-cluster scenarios
// (kept on the original 3401/3402 ports for back-compat with
// every existing spec), the second backs the new multi-cluster
// scenario at 3403/3404.
export const STUB_API_PORT = 3401;
export const STUB_MGMT_PORT = 3402;
export const STUB_API_PORT_B = 3403;
export const STUB_MGMT_PORT_B = 3404;
export const STUB_API_URL = `http://127.0.0.1:${STUB_API_PORT}`;
export const STUB_MGMT_URL = `http://127.0.0.1:${STUB_MGMT_PORT}`;
export const STUB_API_URL_B = `http://127.0.0.1:${STUB_API_PORT_B}`;
export const STUB_MGMT_URL_B = `http://127.0.0.1:${STUB_MGMT_PORT_B}`;

// Per-cluster identity labels. The multi-cluster spec asserts the
// rendered topbar identity flips between clusters, which is only
// observable if each stub returns a distinguishable /v1/me payload.
export const STUB_IDENTITY_A = "stub-A";
export const STUB_IDENTITY_B = "stub-B";

export interface StubHandle {
  apiUrl: string;
  mgmtUrl: string;
  identity: string;
  close: () => Promise<void>;
}

interface StubOptions {
  apiPort: number;
  mgmtPort: number;
  apiUrl: string;
  mgmtUrl: string;
  identity: string;
}

export async function startCacheStub(
  opts?: Partial<StubOptions>,
): Promise<StubHandle> {
  const resolved: StubOptions = {
    apiPort: opts?.apiPort ?? STUB_API_PORT,
    mgmtPort: opts?.mgmtPort ?? STUB_MGMT_PORT,
    apiUrl: opts?.apiUrl ?? STUB_API_URL,
    mgmtUrl: opts?.mgmtUrl ?? STUB_MGMT_URL,
    identity: opts?.identity ?? STUB_IDENTITY_A,
  };

  // Each instance gets its own handler closure so /v1/me returns
  // a stable, instance-specific identity. The handler factory
  // captures the identity; everything else is shared.
  const handler = makeHandle(resolved.identity);
  const apiServer = createServer(handler);
  const mgmtServer = createServer(handler);

  await Promise.all([
    listen(apiServer, resolved.apiPort),
    listen(mgmtServer, resolved.mgmtPort),
  ]);

  return {
    apiUrl: resolved.apiUrl,
    mgmtUrl: resolved.mgmtUrl,
    identity: resolved.identity,
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

function makeHandle(
  identity: string,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    handle(req, res, identity);
  };
}

function handle(
  req: IncomingMessage,
  res: ServerResponse,
  identity: string,
): void {
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

  // /v1/cache/keys — cluster-wide key browser. Listed BEFORE
  // the parameterized /v1/cache/{key} regex below so the literal
  // path isn't swallowed by the param matcher (same ordering
  // rule applies upstream in Fiber).
  if (url.pathname === "/v1/cache/keys" && req.method === "GET") {
    handleListKeys(req, res, url);
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
    res.end(
      JSON.stringify({
        key,
        owners: ["node-1", "node-2", "node-3"],
        node: "node-1",
      }),
    );
    return;
  }

  // Phase C2: GET /v1/me — login probe. Returns the resolved
  // identity for the bearer the request carried. Token validity
  // was already checked above (the Bearer-token gate at the top
  // of `handle`), so reaching this branch means the operator
  // presented a valid token and the cache renders its identity.
  if (url.pathname === "/v1/me" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ id: identity, scopes: ["read", "write", "admin"] }),
    );
    return;
  }

  // Phase C SSE: GET /cluster/events streams `members` and
  // `heartbeat` frames. The stub keeps the response open and
  // emits one `members` snapshot at connect plus a `heartbeat`
  // tick every second until the client disconnects (req close)
  // or the stub server is shut down (which destroys the socket
  // and fires req close from the other side).
  //
  // The frames mirror the production handler's wire shape:
  //   event: members\ndata: { replication, virtualNodes, members[] }\n\n
  //   event: heartbeat\ndata: { heartbeatSuccess, ... }\n\n
  if (url.pathname === "/cluster/events" && req.method === "GET") {
    handleClusterEventsSSE(req, res);
    return;
  }

  // Phase C2 admin controls. The monitor's proxy already gates
  // these on session admin-scope client-side; we mirror the cache
  // binary's response shapes so the UI sees the right status:
  //   /evict + /trigger-expiration → 202 Accepted (fire-and-forget)
  //   /clear                       → 200 OK
  // No body in any of the three — same as the production binary.
  if (req.method === "POST") {
    if (url.pathname === "/evict" || url.pathname === "/trigger-expiration") {
      keyStore.clear();
      res.writeHead(202);
      res.end();
      return;
    }
    if (url.pathname === "/clear") {
      keyStore.clear();
      res.writeHead(200);
      res.end();
      return;
    }
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
function handleCacheKey(
  req: IncomingMessage,
  res: ServerResponse,
  key: string,
  url: URL,
): void {
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
      if (entry.ttlMs !== undefined)
        headers["x-cache-ttl-ms"] = String(entry.ttlMs);
      res.writeHead(200, headers);
      res.end();
      return;
    }
    case "PUT": {
      const ttl = url.searchParams.get("ttl");
      const ttlMs = ttl !== null ? parseGoDurationMs(ttl) : undefined;
      collectBody(req).then((body) => {
        keyStore.set(
          key,
          ttlMs !== undefined ? { bytes: body, ttlMs } : { bytes: body },
        );
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
      res.end(
        JSON.stringify({
          error: "method not allowed",
          code: "METHOD_NOT_ALLOWED",
        }),
      );
  }
}

/**
 * /v1/cache/keys handler — cluster-wide key browser. Drives the
 * Phase B5 KeysBrowser UI. Reads from the shared `keyStore` so
 * a PUT made by an earlier test is visible here.
 *
 * Mirrors the upstream contract: prefix when no glob
 * metacharacters, glob via the same algorithm as `path.Match`
 * (we only need `*` and `?` for the E2E since none of our
 * specs exercise character classes). Caps and pagination
 * mirror the Go handler.
 */
function handleListKeys(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): void {
  const q = url.searchParams.get("q") ?? "";
  const cursorRaw = url.searchParams.get("cursor");
  const limitRaw = url.searchParams.get("limit");

  const cursor = cursorRaw === null || cursorRaw === "" ? 0 : Number(cursorRaw);
  const limit = limitRaw === null || limitRaw === "" ? 100 : Number(limitRaw);

  if (!Number.isFinite(cursor) || cursor < 0) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid cursor", code: "BAD_REQUEST" }));
    return;
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid limit", code: "BAD_REQUEST" }));
    return;
  }

  const matcher = buildStubMatcher(q);
  const all = [...keyStore.keys()].filter(matcher).sort();

  const start = Math.min(cursor, all.length);
  const end = Math.min(start + limit, all.length);
  const page = all.slice(start, end);
  const nextCursor = end < all.length ? String(end) : "";

  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      keys: page,
      next_cursor: nextCursor,
      total_matched: all.length,
      truncated: false,
      node: "node-1",
    }),
  );
}

/**
 * Mirror of the upstream's prefix-vs-glob classifier. Only
 * supports `*` and `?` — character classes (`[abc]`) aren't
 * needed for any E2E scenario, so we keep this tiny.
 */
function buildStubMatcher(pattern: string): (key: string) => boolean {
  if (pattern === "") return () => true;
  if (!/[*?[]/.test(pattern)) {
    return (key) => key.startsWith(pattern);
  }

  // Compile a JS regex equivalent to the glob. Escape regex
  // metacharacters except for `*` (→ `.*`) and `?` (→ `.`).
  const escaped = pattern
    .replace(/[.+^${}()|\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  const re = new RegExp(`^${escaped}$`);
  return (key) => re.test(key);
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
        res.end(
          JSON.stringify({
            error: "invalid JSON: keys[] required",
            code: "BAD_REQUEST",
          }),
        );
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
        items?: Array<{
          key?: string;
          value?: string;
          value_encoding?: string;
          ttl_ms?: number;
        }>;
      } | null;
      if (parsed === null || !Array.isArray(parsed.items)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "invalid JSON: items[] required",
            code: "BAD_REQUEST",
          }),
        );
        return;
      }
      const results = parsed.items.map((item) => {
        if (!item.key || item.key === "") {
          return {
            key: item.key ?? "",
            stored: false,
            error: "missing key",
            code: "BAD_REQUEST",
          };
        }
        const valueStr = item.value ?? "";
        let bytes: Buffer;
        if (item.value_encoding === "base64") {
          try {
            bytes = Buffer.from(valueStr, "base64");
          } catch {
            return {
              key: item.key,
              stored: false,
              error: "invalid base64",
              code: "BAD_REQUEST",
            };
          }
        } else {
          bytes = Buffer.from(valueStr, "utf-8");
        }
        keyStore.set(
          item.key,
          item.ttl_ms !== undefined ? { bytes, ttlMs: item.ttl_ms } : { bytes },
        );
        return {
          key: item.key,
          stored: true,
          bytes: bytes.length,
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

function handleBatchDelete(req: IncomingMessage, res: ServerResponse): void {
  collectBody(req)
    .then((body) => {
      const parsed = parseJson(body) as { keys?: string[] } | null;
      if (parsed === null || !Array.isArray(parsed.keys)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "invalid JSON: keys[] required",
            code: "BAD_REQUEST",
          }),
        );
        return;
      }
      const results = parsed.keys.map((key) => {
        if (key === "") {
          return {
            key,
            deleted: false,
            error: "missing key",
            code: "BAD_REQUEST",
          };
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
        {
          ID: "node-1",
          Address: "hypercache-1:7946",
          State: "alive",
          Incarnation: 723,
        },
        {
          ID: "node-2",
          Address: "hypercache-2:7946",
          State: "alive",
          Incarnation: 723,
        },
        {
          ID: "node-3",
          Address: "hypercache-3:7946",
          State: "alive",
          Incarnation: 723,
        },
        {
          ID: "node-4",
          Address: "hypercache-4:7946",
          State: "alive",
          Incarnation: 723,
        },
        {
          ID: "node-5",
          Address: "hypercache-5:7946",
          State: "alive",
          Incarnation: 1,
        },
      ],
    }),
  },
  "/cluster/ring": {
    contentType: "application/json",
    body: JSON.stringify({
      count: 6,
      vnodes: [
        "aaa:node-1",
        "bbb:node-2",
        "ccc:node-3",
        "ddd:node-4",
        "eee:node-5",
        "fff:node-1",
      ],
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
      "cache.get": {
        Mean: 1.42,
        Median: 1,
        Min: 0,
        Max: 12,
        Count: 4_521,
        Sum: 6_419,
        Variance: 0.85,
      },
      "cache.set": {
        Mean: 2.05,
        Median: 2,
        Min: 1,
        Max: 18,
        Count: 1_207,
        Sum: 2_474,
        Variance: 1.21,
      },
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

/**
 * SSE handler for /cluster/events. Sends `retry: 5000` then a
 * `members` snapshot + `heartbeat` snapshot at connect, and a
 * fresh `heartbeat` snapshot every second until the client
 * disconnects. Mirrors the production handler's frame shape so
 * the monitor's EventSource consumer treats stub and real cache
 * identically.
 *
 * Cleanup is per-connection: the heartbeat tick clears on
 * `req.on("close")`, which fires when the client closes the
 * EventSource OR when the stub's underlying http.Server is
 * destroyed (its socket destruction propagates to the request).
 */
function handleClusterEventsSSE(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  // Matches the static `/cluster/members` fixture shape exactly
  // (5 nodes, same incarnations) so existing specs that polled
  // and asserted node-4 / node-5 visibility don't see the SSE
  // `members` event clobber the cache with a smaller snapshot
  // when SSE wires up.
  const membersSnapshot = {
    replication: 3,
    virtualNodes: 64,
    members: [
      {
        ID: "node-1",
        Address: "hypercache-1:7946",
        State: "alive",
        Incarnation: 723,
      },
      {
        ID: "node-2",
        Address: "hypercache-2:7946",
        State: "alive",
        Incarnation: 723,
      },
      {
        ID: "node-3",
        Address: "hypercache-3:7946",
        State: "alive",
        Incarnation: 723,
      },
      {
        ID: "node-4",
        Address: "hypercache-4:7946",
        State: "alive",
        Incarnation: 723,
      },
      {
        ID: "node-5",
        Address: "hypercache-5:7946",
        State: "alive",
        Incarnation: 1,
      },
    ],
  };

  const heartbeatSnapshot = (probes: number) => ({
    heartbeatSuccess: 12000 + probes,
    heartbeatFailure: 7,
    nodesRemoved: 0,
    readPrimaryPromote: 2,
  });

  res.write(`retry: 5000\n\n`);
  res.write(`event: members\ndata: ${JSON.stringify(membersSnapshot)}\n\n`);
  res.write(
    `event: heartbeat\ndata: ${JSON.stringify(heartbeatSnapshot(0))}\n\n`,
  );

  let probes = 0;
  const tick = setInterval(() => {
    probes += 1;
    // Node's writable.write returns false when buffered; we
    // ignore — the test connections are short-lived and the
    // backpressure isn't a real concern at this rate.
    res.write(
      `event: heartbeat\ndata: ${JSON.stringify(heartbeatSnapshot(probes))}\n\n`,
    );
  }, 1000);

  req.on("close", () => {
    clearInterval(tick);
    res.end();
  });
}
