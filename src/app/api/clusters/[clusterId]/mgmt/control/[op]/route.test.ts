import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

/**
 * Admin-gated control route tests.
 *
 * Phase A's posture: every control op (evict, clear,
 * trigger-expiration) returns 501 unless the operator
 * explicitly opts in via `HYPERCACHE_MONITOR_ENABLE_ADMIN_OPS=true`
 * AND has the admin scope on their session. The 501 is the
 * defense-in-depth gate against the cache server not yet
 * enforcing admin scope on the upstream mgmt port.
 *
 * Tests cover:
 *   - 400 on unknown op names
 *   - 501 when env opt-in is missing (default Phase A posture)
 *   - 403 when env opt-in is set but session lacks admin
 *     (proxy's requiredScope kicks in before fetch)
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
  vi.unstubAllEnvs();
  fetchMock.mockReset();
  vi.mocked(activeSession).mockReset();
  vi.mocked(getCluster).mockReset();
  vi.mocked(getCluster).mockReturnValue(cluster);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function makeReq(): NextRequest {
  // Origin matches nextUrl.origin so the proxy's CSRF check passes.
  return new NextRequest(new URL("http://localhost:3000/api/clusters/default/mgmt/control/evict"), {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
  });
}

function makeCtx(op: string): { params: Promise<{ clusterId: string; op: string }> } {
  return { params: Promise.resolve({ clusterId: "default", op }) };
}

describe("POST /api/clusters/[clusterId]/mgmt/control/[op]", () => {
  it("returns 400 + BAD_REQUEST for unknown ops", async () => {
    vi.mocked(activeSession).mockResolvedValueOnce({
      clusterId: "default",
      session: { token: "tok", identity: "ops", scopes: ["admin"] },
    });
    const res = await POST(makeReq(), makeCtx("nuke-from-orbit"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BAD_REQUEST");
  });

  it("returns 501 + NOT_IMPLEMENTED when admin-ops env opt-in is missing", async () => {
    vi.mocked(activeSession).mockResolvedValueOnce({
      clusterId: "default",
      session: { token: "tok", identity: "ops", scopes: ["admin"] },
    });
    // Default state: env var unset
    const res = await POST(makeReq(), makeCtx("evict"));
    expect(res.status).toBe(501);
    expect((await res.json()).code).toBe("NOT_IMPLEMENTED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 501 even when env is set to a non-true value", async () => {
    vi.mocked(activeSession).mockResolvedValueOnce({
      clusterId: "default",
      session: { token: "tok", identity: "ops", scopes: ["admin"] },
    });
    vi.stubEnv("HYPERCACHE_MONITOR_ENABLE_ADMIN_OPS", "1"); // not "true"
    const res = await POST(makeReq(), makeCtx("evict"));
    expect(res.status).toBe(501);
  });

  it("returns 403 FORBIDDEN when env is opt-in but session lacks admin scope", async () => {
    vi.mocked(activeSession).mockResolvedValueOnce({
      clusterId: "default",
      session: { token: "tok", identity: "ro", scopes: ["read"] },
    });
    vi.stubEnv("HYPERCACHE_MONITOR_ENABLE_ADMIN_OPS", "true");
    const res = await POST(makeReq(), makeCtx("evict"));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("FORBIDDEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards to upstream when env is opt-in AND session has admin scope", async () => {
    vi.mocked(activeSession).mockResolvedValueOnce({
      clusterId: "default",
      session: { token: "tok", identity: "ops", scopes: ["admin"] },
    });
    vi.stubEnv("HYPERCACHE_MONITOR_ENABLE_ADMIN_OPS", "true");
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const res = await POST(makeReq(), makeCtx("evict"));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://cache:8081/evict");
  });
});
