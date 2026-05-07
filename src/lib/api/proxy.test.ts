import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxyToCache } from "./proxy";

/**
 * proxy.test.ts pins the security-critical paths the
 * `proxyToCache` forwarder enforces. These tests are
 * non-optional: a regression in any of them is a
 * direct privilege-escalation or token-leak vector.
 *
 * What's covered:
 *   - 401 when no active session (the proxy is the trust
 *     boundary, even when the cache mgmt port itself is
 *     anonymous)
 *   - 403 + FORBIDDEN when scope gate fails
 *   - 403 + CSRF when Origin header doesn't match
 *   - happy GET passes upstream with bearer + X-Request-Id
 *     injected and Cookie/Host stripped
 *   - 502 + UPSTREAM_FAILURE on fetch throw
 *   - 500 + CLUSTER_GONE when registry can't resolve cluster
 *
 * Mocking strategy: hoisted `vi.mock` factories for the
 * session + registry modules so per-test overrides are
 * possible via `vi.mocked(...).mockResolvedValueOnce(...)`.
 * `globalThis.fetch` is spied with `vi.spyOn` to assert
 * the upstream call shape.
 */

vi.mock("@/lib/auth/session", () => ({
  activeSession: vi.fn(),
}));

vi.mock("@/lib/clusters/registry", () => ({
  getCluster: vi.fn(),
  DEFAULT_CLUSTER_ID: "default",
  listClusters: vi.fn(() => []),
}));

// Re-import the mocked modules so we can configure them per-test.
const { activeSession } = await import("@/lib/auth/session");
const { getCluster } = await import("@/lib/clusters/registry");

// `vi.stubGlobal` swaps out the real `fetch` for our mock for
// the lifetime of the test. We explicitly do NOT use
// `vi.spyOn(globalThis, "fetch")` here: calling `mockReset` on
// a spy *restores* the original implementation, which means
// any test that forgets to queue a `mockResolvedValueOnce`
// would fall through to the real network — connecting to
// `http://cache:8081` and timing out → false 502s in tests.
const fetchMock = vi.fn();

const baseCluster = {
  id: "default",
  name: "Local cluster",
  apiBaseUrl: "http://cache:8080",
  mgmtBaseUrl: "http://cache:8081",
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);

  vi.mocked(activeSession).mockReset();
  vi.mocked(getCluster).mockReset();
  fetchMock.mockReset();

  // Default happy session — tests override per-case.
  vi.mocked(activeSession).mockResolvedValue({
    clusterId: "default",
    session: { token: "session-token", identity: "default", scopes: ["read", "write", "admin"] },
  });
  vi.mocked(getCluster).mockReturnValue(baseCluster);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeReq(opts: {
  method?: string;
  origin?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
}): NextRequest {
  const origin = opts.origin ?? "http://localhost:3000";
  const path = opts.path ?? "/api/clusters/default/mgmt/cluster/members";
  const url = new URL(path, origin);
  const headers = new Headers(opts.headers ?? {});
  if (opts.origin && !headers.has("origin")) {
    headers.set("origin", opts.origin);
  }
  return new NextRequest(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body,
  });
}

describe("proxyToCache", () => {
  it("returns 401 when no active session", async () => {
    vi.mocked(activeSession).mockResolvedValueOnce(null);
    const res = await proxyToCache(makeReq({}), { target: "mgmt", path: "/cluster/members" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("UNAUTHORIZED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 FORBIDDEN when required scope is missing", async () => {
    vi.mocked(activeSession).mockResolvedValueOnce({
      clusterId: "default",
      session: { token: "tok", identity: "ro", scopes: ["read"] },
    });
    const res = await proxyToCache(makeReq({}), {
      target: "mgmt",
      path: "/evict",
      requiredScope: "admin",
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("FORBIDDEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 CSRF when Sec-Fetch-Site reports a cross-site request", async () => {
    const res = await proxyToCache(
      makeReq({
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      }),
      { target: "api", path: "/v1/cache/k" },
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("CSRF");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 CSRF when Sec-Fetch-Site reports a same-site (different-origin) request", async () => {
    const res = await proxyToCache(
      makeReq({
        method: "POST",
        headers: { "sec-fetch-site": "same-site" },
      }),
      { target: "api", path: "/v1/cache/k" },
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("CSRF");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("permits mutating verbs when Sec-Fetch-Site is same-origin", async () => {
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    const res = await proxyToCache(
      makeReq({
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
      { target: "api", path: "/v1/cache/k" },
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back to Origin/Host comparison when Sec-Fetch-Site is absent", async () => {
    // Legacy / non-browser clients without Sec-Fetch-Site fall
    // through to the explicit Origin-host vs Host-header check.
    // Mismatch → 403; match → forwarded.
    const res = await proxyToCache(
      makeReq({
        method: "POST",
        headers: {
          origin: "http://attacker.example",
          host: "localhost:3000",
        },
      }),
      { target: "api", path: "/v1/cache/k" },
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("CSRF");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards GETs upstream with bearer + X-Request-Id and strips Cookie/Host", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    );

    const res = await proxyToCache(
      makeReq({
        headers: {
          cookie: "hcm_session=should-not-leak",
          host: "spoofed.example",
          "x-custom": "preserved",
        },
      }),
      { target: "mgmt", path: "/cluster/members" },
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [calledUrl, init] = fetchMock.mock.calls[0]!;
    expect(String(calledUrl)).toBe("http://cache:8081/cluster/members");

    const sentHeaders = init?.headers as Headers;
    expect(sentHeaders.get("authorization")).toBe("Bearer session-token");
    expect(sentHeaders.get("x-request-id")).toBeTruthy();
    expect(sentHeaders.get("cookie")).toBeNull();
    expect(sentHeaders.get("host")).toBeNull();
    expect(sentHeaders.get("x-custom")).toBe("preserved");
  });

  it("preserves caller-supplied X-Request-Id rather than generating a new one", async () => {
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    await proxyToCache(makeReq({ headers: { "x-request-id": "trace-abc-123" } }), {
      target: "mgmt",
      path: "/health",
    });
    const sentHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(sentHeaders.get("x-request-id")).toBe("trace-abc-123");
  });

  it("surfaces 502 UPSTREAM_FAILURE when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await proxyToCache(makeReq({}), { target: "mgmt", path: "/cluster/members" });
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("UPSTREAM_FAILURE");
  });

  it("returns 500 CLUSTER_GONE when registry resolves to undefined", async () => {
    vi.mocked(getCluster).mockReturnValueOnce(undefined);
    const res = await proxyToCache(makeReq({}), { target: "mgmt", path: "/cluster/members" });
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("CLUSTER_GONE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("targets the api base URL when target=api, mgmt base URL when target=mgmt", async () => {
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    await proxyToCache(makeReq({}), { target: "api", path: "/v1/cache/k" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://cache:8080/v1/cache/k");

    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    await proxyToCache(makeReq({}), { target: "mgmt", path: "/stats" });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("http://cache:8081/stats");
  });

  it("propagates query strings from the inbound request to upstream", async () => {
    fetchMock.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    await proxyToCache(makeReq({ path: "/api/clusters/default/mgmt/dist/owners?key=foo&limit=10" }), {
      target: "mgmt",
      path: "/dist/owners",
    });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("key")).toBe("foo");
    expect(url.searchParams.get("limit")).toBe("10");
  });
});
