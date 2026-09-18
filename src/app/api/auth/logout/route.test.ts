import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
 *
 * Mocks `@/lib/auth/oidc` so the route can import the
 * `isOIDCEnabled` flag + `auth` / `signOut` / `rpInitiatedLogout`
 * helpers without dragging in auth.js's NextAuth() factory +
 * serverEnv evaluation. This test is about the iron-session
 * mutation logic, not the IdP integration — the OIDC-source
 * branch is exercised by re-mocking with `isOIDCEnabled = true`
 * in a dedicated subset (see `enableOIDC`).
 */

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));

vi.mock("@/lib/auth/oidc", () => ({
  isOIDCEnabled: false,
  auth: vi.fn().mockResolvedValue(null),
  signOut: vi.fn(),
  rpInitiatedLogout: vi.fn().mockResolvedValue(true),
}));

const { getSession } = await import("@/lib/auth/session");
const oidcModule = await import("@/lib/auth/oidc");
const { POST } = await import("./route");

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

/**
 * Re-stubs `@/lib/auth/oidc` with `isOIDCEnabled = true` and the
 * full export surface the route's OIDC branch touches. The
 * module-level mock defaults to false; vi.mocked +
 * Object.defineProperty can't override a const export, so each
 * OIDC test calls this (vi.doMock + vi.resetModules) and then
 * re-imports the route. Heavier, but it keeps to the rule: mock
 * only at the call boundary, never mutate module-internal state.
 *
 * `auth()` resolves to null by default — "no auth.js session to
 * read an id_token from" — so the RP-initiated step is skipped
 * cleanly. Leaving `auth` / `rpInitiatedLogout` out of the mock
 * would trip vitest's missing-export guard inside the route's
 * try/catch and spam the best-effort console.warn into CI output
 * while the test still (misleadingly) passes.
 */
function enableOIDC(overrides: Record<string, unknown> = {}): void {
  vi.doMock("@/lib/auth/oidc", () => ({
    isOIDCEnabled: true,
    signOut: oidcModule.signOut,
    auth: vi.fn().mockResolvedValue(null),
    rpInitiatedLogout: vi.fn().mockResolvedValue(true),
    ...overrides,
  }));
  vi.resetModules();
}

describe("POST /api/auth/logout (Phase C — OIDC-source branch)", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
    vi.mocked(oidcModule.signOut).mockReset();
    vi.mocked(oidcModule.signOut).mockResolvedValue(
      new Response(null, { status: 200 }) as never,
    );
  });

  it("calls auth.js signOut on whole-session destroy when an OIDC-sourced session exists and OIDC is enabled", async () => {
    enableOIDC();
    const { POST: postWithOIDC } = await import("./route");

    const session = makeSession({
      activeClusterId: "default",
      sessions: {
        default: {
          token: "idp-jwt",
          identity: "alice",
          scopes: ["read"],
          // @ts-expect-error — OIDC source extension on the
          // FakeSession sessions value type. The real
          // ClusterSession has source?: 'static'|'oidc'.
          source: "oidc",
        },
      },
    });
    vi.mocked(getSession).mockResolvedValueOnce(session as never);

    const res = await postWithOIDC(makeReq());

    expect(res.status).toBe(200);
    expect(session.destroy).toHaveBeenCalledOnce();
    expect(oidcModule.signOut).toHaveBeenCalledWith({ redirect: false });
  });

  it("does not call auth.js signOut when no OIDC-sourced session exists", async () => {
    enableOIDC();
    const { POST: postWithOIDC } = await import("./route");

    const session = makeSession({
      activeClusterId: "default",
      sessions: {
        default: { token: "static-bearer", identity: "ops", scopes: ["read"] },
      },
    });
    vi.mocked(getSession).mockResolvedValueOnce(session as never);

    const res = await postWithOIDC(makeReq());

    expect(res.status).toBe(200);
    expect(session.destroy).toHaveBeenCalledOnce();
    expect(oidcModule.signOut).not.toHaveBeenCalled();
  });

  it("calls auth.js signOut on per-cluster logout when dropping the last OIDC session", async () => {
    enableOIDC();
    const { POST: postWithOIDC } = await import("./route");

    const session = makeSession({
      activeClusterId: "secondary",
      sessions: {
        default: { token: "static", identity: "ops", scopes: ["read"] },
        secondary: {
          token: "idp-jwt",
          identity: "alice",
          scopes: ["read"],
          // @ts-expect-error — OIDC source extension; see above.
          source: "oidc",
        },
      },
    });
    vi.mocked(getSession).mockResolvedValueOnce(session as never);

    const res = await postWithOIDC(makeReq("cluster=secondary"));

    expect(res.status).toBe(200);
    expect(oidcModule.signOut).toHaveBeenCalledWith({ redirect: false });
    // The static-bearer entry survives.
    expect(session.sessions).toEqual({
      default: { token: "static", identity: "ops", scopes: ["read"] },
    });
  });

  it("does NOT call auth.js signOut on per-cluster logout when another OIDC session remains", async () => {
    enableOIDC();
    const { POST: postWithOIDC } = await import("./route");

    const session = makeSession({
      activeClusterId: "secondary",
      sessions: {
        primary: {
          token: "idp-jwt-1",
          identity: "alice",
          scopes: ["read"],
          // @ts-expect-error — OIDC source extension; see above.
          source: "oidc",
        },
        secondary: {
          token: "idp-jwt-2",
          identity: "alice",
          scopes: ["read"],
          // @ts-expect-error — OIDC source extension; see above.
          source: "oidc",
        },
      },
    });
    vi.mocked(getSession).mockResolvedValueOnce(session as never);

    const res = await postWithOIDC(makeReq("cluster=secondary"));

    expect(res.status).toBe(200);
    // primary still holds an OIDC session — must keep auth.js cookie.
    expect(oidcModule.signOut).not.toHaveBeenCalled();
  });

  it("swallows auth.js signOut errors so iron-session destroy still completes", async () => {
    enableOIDC();
    const { POST: postWithOIDC } = await import("./route");

    vi.mocked(oidcModule.signOut).mockRejectedValueOnce(
      new Error("IdP unreachable"),
    );

    const session = makeSession({
      activeClusterId: "default",
      sessions: {
        default: {
          token: "idp-jwt",
          identity: "alice",
          scopes: ["read"],
          // @ts-expect-error — OIDC source extension; see above.
          source: "oidc",
        },
      },
    });
    vi.mocked(getSession).mockResolvedValueOnce(session as never);

    // The console.warn from the swallow path is expected — silence it.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await postWithOIDC(makeReq());

    expect(res.status).toBe(200);
    expect(session.destroy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("hits the IdP's end_session_endpoint with id_token_hint on OIDC-sourced logout", async () => {
    // The flow under test: whole-session destroy with an OIDC-
    // sourced binding should call rpInitiatedLogout(idToken) BEFORE
    // calling auth.js's local signOut. Without this step, the IdP
    // session persists and SSO silently re-authenticates the
    // operator on the next sign-in click.
    const rpInitiatedLogout = vi.fn().mockResolvedValue(true);
    const authMock = vi.fn().mockResolvedValue({ idToken: "test-id-token" });

    enableOIDC({ auth: authMock, rpInitiatedLogout });
    const { POST: postWithOIDC } = await import("./route");

    const session = makeSession({
      activeClusterId: "default",
      sessions: {
        default: {
          token: "idp-jwt",
          identity: "alice",
          scopes: ["read"],
          // @ts-expect-error — OIDC source extension; see above.
          source: "oidc",
        },
      },
    });
    vi.mocked(getSession).mockResolvedValueOnce(session as never);

    const res = await postWithOIDC(makeReq());

    expect(res.status).toBe(200);
    expect(rpInitiatedLogout).toHaveBeenCalledWith("test-id-token");
    // Local signOut still runs to clear auth.js's cookie alongside
    // the remote IdP session termination.
    expect(oidcModule.signOut).toHaveBeenCalled();
    expect(session.destroy).toHaveBeenCalledOnce();
  });

  it("swallows RP-initiated logout failures so iron-session destroy still completes", async () => {
    // IdP unreachable, end_session_endpoint absent, network blip —
    // the iron-session destroy must still happen so the operator
    // is at least signed out locally.
    const rpInitiatedLogout = vi
      .fn()
      .mockRejectedValue(new Error("IdP unreachable"));
    const authMock = vi.fn().mockResolvedValue({ idToken: "test-id-token" });

    enableOIDC({ auth: authMock, rpInitiatedLogout });
    const { POST: postWithOIDC } = await import("./route");

    const session = makeSession({
      activeClusterId: "default",
      sessions: {
        default: {
          token: "idp-jwt",
          identity: "alice",
          scopes: ["read"],
          // @ts-expect-error — OIDC source extension; see above.
          source: "oidc",
        },
      },
    });
    vi.mocked(getSession).mockResolvedValueOnce(session as never);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await postWithOIDC(makeReq());

    expect(res.status).toBe(200);
    expect(session.destroy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
