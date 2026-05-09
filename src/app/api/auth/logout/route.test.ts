import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

/**
 * Pins the two logout shapes:
 *
 *   POST /api/auth/logout                 → whole-session destroy
 *   POST /api/auth/logout?cluster=<id>    → drop one entry
 *
 * Mocks `getSession` directly because iron-session's real impl
 * needs a cookie store. The hand-rolled FakeSession exposes the
 * mutable shape the route actually touches (activeClusterId,
 * sessions, save, destroy).
 */

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));

const { getSession } = await import("@/lib/auth/session");

interface FakeSession {
  activeClusterId?: string;
  sessions?: Record<
    string,
    { token: string; identity: string; scopes: ("read" | "write" | "admin")[] }
  >;
  save: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

function makeSession(initial: Partial<FakeSession> = {}): FakeSession {
  // destroy() in iron-session clears the cookie; our fake just
  // marks the call so tests can assert on it. We also clear the
  // local copy of sessions+activeClusterId to mirror the real
  // post-destroy state for any code that reads after destroy.
  const fake: FakeSession = {
    activeClusterId: initial.activeClusterId,
    sessions: initial.sessions,
    save: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(() => {
      fake.activeClusterId = undefined;
      fake.sessions = undefined;
    }),
  };
  return fake;
}

function makeReq(query?: string): NextRequest {
  const suffix = query !== undefined ? `?${query}` : "";
  return new NextRequest(
    new URL(`http://localhost:3000/api/auth/logout${suffix}`),
    { method: "POST" },
  );
}

beforeEach(() => {
  vi.mocked(getSession).mockReset();
});

describe("POST /api/auth/logout", () => {
  it("destroys the whole session when no cluster query param is set", async () => {
    const session = makeSession({
      activeClusterId: "default",
      sessions: {
        default: { token: "t1", identity: "ops", scopes: ["read"] },
        secondary: { token: "t2", identity: "ops", scopes: ["read"] },
      },
    });
    vi.mocked(getSession).mockResolvedValueOnce(session as never);

    const res = await POST(makeReq());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mode: "all" });
    expect(session.destroy).toHaveBeenCalledOnce();
    expect(session.save).not.toHaveBeenCalled();
  });

  it("drops just the named cluster's entry and reassigns active when dropping the active", async () => {
    const session = makeSession({
      activeClusterId: "secondary",
      sessions: {
        default: { token: "t1", identity: "ops", scopes: ["read"] },
        secondary: { token: "t2", identity: "ops", scopes: ["read"] },
      },
    });
    vi.mocked(getSession).mockResolvedValueOnce(session as never);

    const res = await POST(makeReq("cluster=secondary"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      mode: "cluster",
      clusterId: "secondary",
      removed: true,
      activeClusterId: "default",
    });
    expect(session.sessions).toEqual({
      default: { token: "t1", identity: "ops", scopes: ["read"] },
    });
    expect(session.activeClusterId).toBe("default");
    expect(session.destroy).not.toHaveBeenCalled();
    expect(session.save).toHaveBeenCalledOnce();
  });

  it("keeps activeClusterId unchanged when dropping a non-active cluster", async () => {
    const session = makeSession({
      activeClusterId: "default",
      sessions: {
        default: { token: "t1", identity: "ops", scopes: ["read"] },
        secondary: { token: "t2", identity: "ops", scopes: ["read"] },
      },
    });
    vi.mocked(getSession).mockResolvedValueOnce(session as never);

    const res = await POST(makeReq("cluster=secondary"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ activeClusterId: "default" });
    expect(session.activeClusterId).toBe("default");
    expect(session.sessions).toEqual({
      default: { token: "t1", identity: "ops", scopes: ["read"] },
    });
  });

  it("destroys the whole session when dropping the only bound cluster", async () => {
    const session = makeSession({
      activeClusterId: "default",
      sessions: { default: { token: "t1", identity: "ops", scopes: ["read"] } },
    });
    vi.mocked(getSession).mockResolvedValueOnce(session as never);

    const res = await POST(makeReq("cluster=default"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      mode: "cluster",
      clusterId: "default",
      removed: true,
      sessionDestroyed: true,
    });
    expect(session.destroy).toHaveBeenCalledOnce();
    // save() must not have been called after destroy — iron-session
    // would write back a stale session cookie.
    expect(session.save).not.toHaveBeenCalled();
  });

  it("returns ok+removed=false when the cluster is not bound (idempotent)", async () => {
    const session = makeSession({
      activeClusterId: "default",
      sessions: { default: { token: "t1", identity: "ops", scopes: ["read"] } },
    });
    vi.mocked(getSession).mockResolvedValueOnce(session as never);

    const res = await POST(makeReq("cluster=ghost"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      mode: "cluster",
      clusterId: "ghost",
      removed: false,
    });
    // No mutation — original entry intact.
    expect(session.sessions).toEqual({
      default: { token: "t1", identity: "ops", scopes: ["read"] },
    });
    expect(session.destroy).not.toHaveBeenCalled();
    expect(session.save).not.toHaveBeenCalled();
  });

  it("picks the alphabetically-first remaining cluster as the new active", async () => {
    const session = makeSession({
      activeClusterId: "zebra",
      sessions: {
        alpha: { token: "ta", identity: "ops", scopes: ["read"] },
        mike: { token: "tm", identity: "ops", scopes: ["read"] },
        zebra: { token: "tz", identity: "ops", scopes: ["read"] },
      },
    });
    vi.mocked(getSession).mockResolvedValueOnce(session as never);

    const res = await POST(makeReq("cluster=zebra"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ activeClusterId: "alpha" });
    expect(session.activeClusterId).toBe("alpha");
  });

  it("returns 400 BAD_REQUEST when the cluster query param has illegal characters", async () => {
    const res = await POST(makeReq("cluster=../etc/passwd"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BAD_REQUEST");
    // getSession must not have been touched on the rejected path.
    expect(getSession).not.toHaveBeenCalled();
  });
});
