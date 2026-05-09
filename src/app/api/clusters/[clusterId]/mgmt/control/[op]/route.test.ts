import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

/**
 * Phase C2 admin-gated control route tests.
 *
 * Behavior the proxy guarantees:
 *   - 400 BAD_REQUEST on unknown op names (catch typos before
 *     they hit the upstream cache).
 *   - 403 FORBIDDEN when the session lacks admin scope (proxy's
 *     `requiredScope: "admin"` check; never reaches fetch).
 *   - Forwards to mgmt port `/<op>` with the operator's bearer
 *     when admin scope is present.
 *
 * Phase C1's `HYPERCACHE_MONITOR_ENABLE_ADMIN_OPS` env gate has
 * been retired (defense-in-depth belt that's no longer needed:
 * cache enforces admin-scope server-side; monitor enforces it
 * client-side via the post-C2 sealed real scopes from /v1/me).
 */

vi.mock("@/lib/auth/session", () => ({
  activeSession: vi.fn(),
}));

vi.mock("@/lib/clusters/registry", () => ({
  getCluster: vi.fn(),
  DEFAULT_CLUSTER_ID: "default",
  listClusters: vi.fn(() => []),
}));

const { activeSession } = await import("@/lib/auth/session");
const { getCluster } = await import("@/lib/clusters/registry");

const fetchMock = vi.fn();

const cluster = {
  id: "default",
  name: "Local cluster",
  apiBaseUrl: "http://cache:8080",
  mgmtBaseUrl: "http://cache:8081",
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.mocked(activeSession).mockReset();
  vi.mocked(getCluster).mockReset();
  vi.mocked(getCluster).mockReturnValue(cluster);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeReq(): NextRequest {
  // Sec-Fetch-Site=same-origin satisfies the proxy's CSRF gate
  // — modern browsers set it on every fetch and the proxy
  // trusts it as the authoritative same-origin signal.
  return new NextRequest(new URL("http://localhost:3000/api/clusters/default/mgmt/control/evict"), {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
  });
}

function makeCtx(op: string): { params: Promise<{ clusterId: string; op: string }> } {
  return { params: Promise.resolve({ clusterId: "default", op }) };
}

describe("POST /api/clusters/[clusterId]/mgmt/control/[op]", () => {
  it("returns 400 + BAD_REQUEST for unknown ops (caught before scope check)", async () => {
    // No activeSession mock needed — the unknown-op guard runs
    // before proxyToCache, so the session is never consulted.
    const res = await POST(makeReq(), makeCtx("nuke-from-orbit"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BAD_REQUEST");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 FORBIDDEN when the session lacks admin scope", async () => {
    vi.mocked(activeSession).mockResolvedValueOnce({
      clusterId: "default",
      session: { token: "tok", identity: "ro", scopes: ["read"] },
    });
    const res = await POST(makeReq(), makeCtx("evict"));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("FORBIDDEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 FORBIDDEN even when the session has read+write but not admin", async () => {
    // Pins the inclusive (non-hierarchical) scope semantics:
    // ScopeWrite alone does NOT imply ScopeAdmin. A token granted
    // read+write scope still cannot evict.
    vi.mocked(activeSession).mockResolvedValueOnce({
      clusterId: "default",
      session: { token: "tok", identity: "rw", scopes: ["read", "write"] },
    });
    const res = await POST(makeReq(), makeCtx("clear"));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("FORBIDDEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards /evict to the mgmt port when the session has admin scope", async () => {
    vi.mocked(activeSession).mockResolvedValueOnce({
      clusterId: "default",
      session: { token: "tok", identity: "ops", scopes: ["read", "write", "admin"] },
    });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }));

    const res = await POST(makeReq(), makeCtx("evict"));
    expect(res.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://cache:8081/evict");
    // Bearer token forwarded — operator's identity travels to the cache
    // for any audit attribution the cache wires up later.
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer tok");
  });

  it("forwards /clear and /trigger-expiration with admin scope", async () => {
    for (const op of ["clear", "trigger-expiration"]) {
      vi.mocked(activeSession).mockResolvedValueOnce({
        clusterId: "default",
        session: { token: "tok", identity: "ops", scopes: ["admin"] },
      });
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      const res = await POST(makeReq(), makeCtx(op));
      expect(res.status).toBe(200);
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe(`http://cache:8081/${op}`);
    }
  });

  it("surfaces upstream 502 when the cache mgmt port is unreachable", async () => {
    vi.mocked(activeSession).mockResolvedValueOnce({
      clusterId: "default",
      session: { token: "tok", identity: "ops", scopes: ["admin"] },
    });
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await POST(makeReq(), makeCtx("evict"));
    expect(res.status).toBe(502);
  });
});
