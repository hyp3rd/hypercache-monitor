import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

/**
 * Pins the Phase C2 login route's branches:
 *
 *   200 — happy path: /v1/me returns {id, scopes}, session sealed with
 *         the real identity + real scopes (not the legacy optimistic
 *         three-scope grant).
 *   401 UNAUTHORIZED — cache returns 401 (invalid bearer).
 *   403 FORBIDDEN — cache returns 403 (token lacks read scope).
 *   502 UPSTREAM_FAILURE — cache returns 404 (pre-C2 binary), 5xx,
 *         or a body that doesn't match the IdentityResponse schema.
 *   400 BAD_REQUEST — body shape rejected by zod.
 *
 * Mocks `fetch` for the upstream probe and `getSession` for the
 * cookie sealing. We assert on the sealed session shape directly
 * because that's the security-critical output: a wrong identity
 * or wrong scope set would compromise downstream auth gates.
 */

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/clusters/registry", () => ({
  getCluster: vi.fn(),
  DEFAULT_CLUSTER_ID: "default",
}));

const { getSession } = await import("@/lib/auth/session");
const { getCluster } = await import("@/lib/clusters/registry");

const fakeCluster = {
  id: "default",
  name: "Local cluster",
  apiBaseUrl: "http://cache:8080",
  mgmtBaseUrl: "http://cache:8081",
};

interface FakeSession {
  activeClusterId?: string;
  sessions?: Record<string, { token: string; identity: string; scopes: ("read" | "write" | "admin")[] }>;
  save: ReturnType<typeof vi.fn>;
}

function makeSession(initial: Partial<FakeSession> = {}): FakeSession {
  return {
    activeClusterId: initial.activeClusterId,
    sessions: initial.sessions,
    save: vi.fn().mockResolvedValue(undefined),
  };
}

function makeReq(body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/auth/login"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.mocked(getSession).mockReset();
  vi.mocked(getCluster).mockReset();
  vi.mocked(getCluster).mockReturnValue(fakeCluster);
});

describe("POST /api/auth/login (Phase C2 — /v1/me probe)", () => {
  it("seals real identity + scopes from /v1/me on happy path", async () => {
    const session = makeSession({});
    vi.mocked(getSession).mockResolvedValueOnce(session as never);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "ops-rw", scopes: ["read", "write"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await POST(makeReq({ token: "t" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, clusterId: "default", identity: "ops-rw" });
    expect(body.scopes).toEqual(["read", "write"]);

    expect(session.activeClusterId).toBe("default");
    expect(session.sessions?.["default"]).toEqual({
      token: "t",
      identity: "ops-rw",
      scopes: ["read", "write"],
    });
    expect(session.save).toHaveBeenCalledOnce();
    // Probed the right URL with the bearer header.
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://cache:8080/v1/me");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer t" });
  });

  it("ignores unknown forward-compat fields in /v1/me body", async () => {
    const session = makeSession({});
    vi.mocked(getSession).mockResolvedValueOnce(session as never);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "ops", scopes: ["read"], via: "bearer", future_field: 42 }), {
        status: 200,
      }),
    );

    const res = await POST(makeReq({ token: "t" }));
    expect(res.status).toBe(200);
    expect(session.sessions?.["default"]?.scopes).toEqual(["read"]);
  });

  it("returns 401 UNAUTHORIZED when /v1/me returns 401", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    const res = await POST(makeReq({ token: "wrong" }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("UNAUTHORIZED");
    expect(getSession).not.toHaveBeenCalled();
  });

  it("returns 403 FORBIDDEN when /v1/me returns 403 (no read scope)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 403 }));
    const res = await POST(makeReq({ token: "t" }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("FORBIDDEN");
  });

  it("returns 502 UPSTREAM_FAILURE with version-skew message on 404", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    const res = await POST(makeReq({ token: "t" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("UPSTREAM_FAILURE");
    expect(body.error).toMatch(/cache server too old/);
  });

  it("returns 502 UPSTREAM_FAILURE on transport error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await POST(makeReq({ token: "t" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("UPSTREAM_FAILURE");
    expect(body.error).toMatch(/ECONNREFUSED/);
  });

  it("returns 502 UPSTREAM_FAILURE on unexpected upstream status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    const res = await POST(makeReq({ token: "t" }));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("UPSTREAM_FAILURE");
  });

  it("returns 502 when /v1/me returns non-JSON body", async () => {
    fetchMock.mockResolvedValueOnce(new Response("garbage-not-json", { status: 200 }));
    const res = await POST(makeReq({ token: "t" }));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("UPSTREAM_FAILURE");
  });

  it("returns 502 when /v1/me returns malformed shape (missing id)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ scopes: ["read"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const res = await POST(makeReq({ token: "t" }));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("UPSTREAM_FAILURE");
  });

  it("returns 502 when /v1/me returns an unknown scope (forward-incompat)", async () => {
    // A future cache could add a "trace" scope. Older monitors would
    // see it as an unknown enum and reject. That's the right shape:
    // the monitor cannot enforce a scope it does not understand.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "ops", scopes: ["read", "trace"] }), {
        status: 200,
      }),
    );
    const res = await POST(makeReq({ token: "t" }));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("UPSTREAM_FAILURE");
  });

  it("returns 400 BAD_REQUEST when body has no token", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BAD_REQUEST");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 BAD_REQUEST when body is malformed JSON", async () => {
    const res = await POST(makeReq("not-json{"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BAD_REQUEST");
  });

  it("returns 400 BAD_REQUEST when clusterId has illegal characters", async () => {
    const res = await POST(makeReq({ token: "t", clusterId: "../evil" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BAD_REQUEST");
    expect(getCluster).not.toHaveBeenCalled();
  });

  it("returns 400 BAD_REQUEST when cluster is unknown", async () => {
    vi.mocked(getCluster).mockReturnValueOnce(undefined);
    const res = await POST(makeReq({ token: "t", clusterId: "missing" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BAD_REQUEST");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("seals under the chosen clusterId, not DEFAULT_CLUSTER_ID", async () => {
    vi.mocked(getCluster).mockReturnValueOnce({
      id: "prod-eu",
      name: "Production EU",
      apiBaseUrl: "https://cache-eu.example.com",
      mgmtBaseUrl: "https://cache-eu.example.com:8081",
    });
    const session = makeSession({
      sessions: { default: { token: "old", identity: "default", scopes: ["read"] } },
    });
    vi.mocked(getSession).mockResolvedValueOnce(session as never);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "eu-ops", scopes: ["read", "admin"] }), { status: 200 }),
    );

    const res = await POST(makeReq({ token: "eu-token", clusterId: "prod-eu" }));
    expect(res.status).toBe(200);

    expect(session.activeClusterId).toBe("prod-eu");
    expect(session.sessions?.["prod-eu"]).toEqual({
      token: "eu-token",
      identity: "eu-ops",
      scopes: ["read", "admin"],
    });
    // Other cluster's session preserved (multi-cluster cookie shape).
    expect(session.sessions?.["default"]).toEqual({
      token: "old",
      identity: "default",
      scopes: ["read"],
    });
  });
});
