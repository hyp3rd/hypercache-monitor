import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

/**
 * Pins the cluster-switch route's three branches:
 *
 *   200 — happy path: known cluster, session exists, activeId flips
 *   400 — unknown cluster id (registry typo / stale tab after
 *         operator removed an entry from clusters.yaml)
 *   401 NEED_LOGIN — known cluster, no session bound; client
 *         must redirect operator to /login?cluster=<id>
 *   400 BAD_REQUEST — body shape rejected by zod
 *
 * Mocks `getSession` directly because iron-session's real impl
 * needs a cookie store; we substitute a hand-rolled object
 * exposing the bits the route actually touches.
 */

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/clusters/registry", () => ({
  getCluster: vi.fn(),
}));

const { getSession } = await import("@/lib/auth/session");
const { getCluster } = await import("@/lib/clusters/registry");

const fakeCluster = {
  id: "prod-eu",
  name: "Production EU",
  apiBaseUrl: "https://cache-eu.example.com",
  mgmtBaseUrl: "https://cache-eu.example.com:8081",
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
  return new NextRequest(new URL("http://localhost:3000/api/auth/switch-cluster"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(getSession).mockReset();
  vi.mocked(getCluster).mockReset();
});

describe("POST /api/auth/switch-cluster", () => {
  it("flips activeClusterId and saves on happy path", async () => {
    const session = makeSession({
      activeClusterId: "default",
      sessions: {
        default: { token: "t1", identity: "default", scopes: ["read"] },
        "prod-eu": { token: "t2", identity: "prod-eu", scopes: ["read"] },
      },
    });
    vi.mocked(getSession).mockResolvedValueOnce(session as never);
    vi.mocked(getCluster).mockReturnValueOnce(fakeCluster);

    const res = await POST(makeReq({ clusterId: "prod-eu" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, clusterId: "prod-eu" });
    expect(session.activeClusterId).toBe("prod-eu");
    expect(session.save).toHaveBeenCalledOnce();
  });

  it("returns 400 BAD_REQUEST when body is missing clusterId", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BAD_REQUEST");
    expect(getSession).not.toHaveBeenCalled();
  });

  it("returns 400 BAD_REQUEST when body is malformed JSON", async () => {
    const res = await POST(makeReq("not-json{"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BAD_REQUEST");
  });

  it("returns 400 BAD_REQUEST when clusterId has illegal characters", async () => {
    const res = await POST(makeReq({ clusterId: "../../etc/passwd" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BAD_REQUEST");
    // getCluster must not be invoked with an unsanitized id
    expect(getCluster).not.toHaveBeenCalled();
  });

  it("returns 400 BAD_REQUEST when cluster is unknown to the registry", async () => {
    vi.mocked(getCluster).mockReturnValueOnce(undefined);
    const res = await POST(makeReq({ clusterId: "removed-cluster" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BAD_REQUEST");
    expect(getSession).not.toHaveBeenCalled();
  });

  it("returns 401 NEED_LOGIN when cluster exists but session has no entry", async () => {
    const session = makeSession({
      activeClusterId: "default",
      sessions: { default: { token: "t1", identity: "default", scopes: ["read"] } },
    });
    vi.mocked(getSession).mockResolvedValueOnce(session as never);
    vi.mocked(getCluster).mockReturnValueOnce(fakeCluster);

    const res = await POST(makeReq({ clusterId: "prod-eu" }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("NEED_LOGIN");
    expect(body.clusterId).toBe("prod-eu");
    // Session must not be touched on the NEED_LOGIN path —
    // flipping activeClusterId here would strand the proxy
    // requesting credentials we don't have.
    expect(session.activeClusterId).toBe("default");
    expect(session.save).not.toHaveBeenCalled();
  });

  it("returns 401 NEED_LOGIN when sessions map is undefined", async () => {
    const session = makeSession({});
    vi.mocked(getSession).mockResolvedValueOnce(session as never);
    vi.mocked(getCluster).mockReturnValueOnce(fakeCluster);

    const res = await POST(makeReq({ clusterId: "prod-eu" }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("NEED_LOGIN");
  });
});
