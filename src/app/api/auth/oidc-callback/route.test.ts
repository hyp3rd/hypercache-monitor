import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pins the Phase C OIDC post-callback handler:
 *
 *   302 → /topology — happy path: auth.js session has accessToken,
 *         /v1/me succeeds, iron-session sealed with `source: "oidc"`.
 *   302 → /login — no auth.js session (operator deep-linked or
 *         the IdP roundtrip aborted before auth.js sealed its cookie).
 *   401 — cluster's /v1/me rejects the token (signature/aud failure).
 *   403 — cluster's /v1/me 403s (token has no read scope here).
 *   502 — upstream transport failure or non-JSON body.
 *   400 — invalid `?cluster=` query (regex mismatch) or unknown id.
 *   404 — OIDC env not configured (handler is mounted but inactive).
 *
 * Mocks `auth()` for the auth.js session, `getSession` for iron-
 * session, and `getCluster` for the registry. The fetch mock
 * returns the cache's /v1/me probe response.
 */

const VALID_SECRET = "x".repeat(48); // satisfies min(32) — generated value-shape, not a real secret

// Stub OIDC env so isOIDCEnabled is true at module-load time.
// We do this BEFORE importing the route module, since `serverEnv`
// evaluates at top level.
delete process.env.AUTH_OIDC_ISSUER;
delete process.env.AUTH_OIDC_CLIENT_ID;
delete process.env.AUTH_OIDC_CLIENT_SECRET;
delete process.env.AUTH_OIDC_PROVIDER_NAME;
delete process.env.AUTH_OIDC_SCOPES;
delete process.env.AUTH_SECRET;
process.env.NEXT_PHASE = "";
process.env.HYPERCACHE_API_URL = "http://cache:8080";
process.env.HYPERCACHE_MGMT_URL = "http://cache:8081";
process.env.IRON_SESSION_SECRET = VALID_SECRET;
process.env.AUTH_OIDC_ISSUER = "https://idp.example.com";
process.env.AUTH_OIDC_CLIENT_ID = "client-abc";
process.env.AUTH_OIDC_CLIENT_SECRET = "client-secret-xyz";
process.env.AUTH_SECRET = VALID_SECRET;

vi.mock("@/lib/auth/oidc", () => ({ auth: vi.fn(), isOIDCEnabled: true }));

vi.mock("@/lib/auth/session", () => ({ getSessionFor: vi.fn() }));

vi.mock("@/lib/clusters/registry", () => ({
  getCluster: vi.fn(),
  DEFAULT_CLUSTER_ID: "default",
}));

const { auth } = await import("@/lib/auth/oidc");
const { getSessionFor } = await import("@/lib/auth/session");
const { getCluster } = await import("@/lib/clusters/registry");
const { GET } = await import("./route");

const fakeCluster = {
  id: "default",
  name: "Local cluster",
  apiBaseUrl: "http://cache:8080",
  mgmtBaseUrl: "http://cache:8081",
};

interface FakeSession {
  activeClusterId?: string;
  sessions?: Record<
    string,
    {
      token: string;
      identity: string;
      scopes: ("read" | "write" | "admin")[];
      source?: "static" | "oidc";
    }
  >;
  save: ReturnType<typeof vi.fn>;
}

function makeSession(initial: Partial<FakeSession> = {}): FakeSession {
  return {
    activeClusterId: initial.activeClusterId,
    sessions: initial.sessions,
    save: vi.fn().mockResolvedValue(undefined),
  };
}

function makeReq(query?: string): NextRequest {
  const url = new URL(
    `http://localhost:3000/api/auth/oidc-callback${query ? `?${query}` : ""}`,
  );
  return new NextRequest(url, { method: "GET" });
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.mocked(auth).mockReset();
  vi.mocked(getSessionFor).mockReset();
  vi.mocked(getCluster).mockReset();
  vi.mocked(getCluster).mockReturnValue(fakeCluster);
});

describe("GET /api/auth/oidc-callback (Phase C)", () => {
  it("seals iron-session with source: 'oidc' and redirects to /topology on happy path", async () => {
    vi.mocked(auth).mockResolvedValueOnce({
      accessToken: "idp-issued-jwt",
    } as never);
    const session = makeSession({});
    vi.mocked(getSessionFor).mockResolvedValueOnce(session as never);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: "alice@example.com", scopes: ["read", "write"] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await GET(makeReq("cluster=default"));

    expect(res.status).toBe(307); // NextResponse.redirect default
    expect(res.headers.get("location")).toBe("http://localhost:3000/topology");
    // Sealed shape — identity + scopes from /v1/me, source marker
    // for the logout path to detect OIDC sessions.
    expect(session.activeClusterId).toBe("default");
    // For OIDC-sourced bindings the access token is NOT stored in
    // iron-session — it can blow past the 4 KiB browser cookie
    // limit. The proxy reads the live token via the activeSession
    // bridge, which calls auth.js for the current accessToken.
    expect(session.sessions?.["default"]).toEqual({
      token: "",
      identity: "alice@example.com",
      scopes: ["read", "write"],
      source: "oidc",
    });
    expect(session.save).toHaveBeenCalledOnce();
    // Probed the right URL with the bearer header.
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://cache:8080/v1/me");
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer idp-issued-jwt",
    });
  });

  it("redirects to /login when auth.js session has no accessToken", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);

    const res = await GET(makeReq("cluster=default"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/login?cluster=default",
    );
    expect(getSessionFor).not.toHaveBeenCalled();
  });

  it("returns 401 UNAUTHORIZED when /v1/me rejects the token", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ accessToken: "t" } as never);
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));

    const res = await GET(makeReq("cluster=default"));

    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("UNAUTHORIZED");
    expect(getSessionFor).not.toHaveBeenCalled();
  });

  it("returns 403 FORBIDDEN when /v1/me 403s (no read scope)", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ accessToken: "t" } as never);
    fetchMock.mockResolvedValueOnce(new Response("", { status: 403 }));

    const res = await GET(makeReq("cluster=default"));

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("FORBIDDEN");
  });

  it("returns 502 UPSTREAM_FAILURE on transport error", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ accessToken: "t" } as never);
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await GET(makeReq("cluster=default"));

    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("UPSTREAM_FAILURE");
  });

  it("returns 502 UPSTREAM_FAILURE on non-JSON /v1/me body", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ accessToken: "t" } as never);
    fetchMock.mockResolvedValueOnce(new Response("not-json", { status: 200 }));

    const res = await GET(makeReq("cluster=default"));

    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("UPSTREAM_FAILURE");
  });

  it("returns 400 BAD_REQUEST on invalid cluster id (regex mismatch)", async () => {
    const res = await GET(makeReq("cluster=ev!l"));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BAD_REQUEST");
    expect(auth).not.toHaveBeenCalled();
  });

  it("returns 400 BAD_REQUEST when cluster id is unknown to the registry", async () => {
    vi.mocked(getCluster).mockReturnValueOnce(undefined);

    const res = await GET(makeReq("cluster=ghost"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("BAD_REQUEST");
    expect(body.error).toMatch(/unknown cluster: ghost/);
  });

  it("falls back to DEFAULT_CLUSTER_ID when no cluster query is provided", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ accessToken: "t" } as never);
    const session = makeSession({});
    vi.mocked(getSessionFor).mockResolvedValueOnce(session as never);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "ops", scopes: ["read"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await GET(makeReq());

    expect(res.status).toBe(307);
    expect(getCluster).toHaveBeenCalledWith("default");
    expect(session.activeClusterId).toBe("default");
  });

  it("binds iron-session to the redirect response so Set-Cookie survives the redirect", async () => {
    // Regression guard for the bug we hit on the OIDC docker stack:
    // calling `getSession()` (cookieStore overload) and then
    // returning `NextResponse.redirect(...)` silently dropped the
    // iron-session Set-Cookie header in Next.js 16, because the
    // cookies-set-via-next/headers auto-merge doesn't propagate onto
    // a freshly-constructed redirect response. The proxy on the next
    // request saw an empty session and bounced operators to /login.
    //
    // The route must call `getSessionFor(req, res)` with the
    // already-constructed redirect response so iron-session writes
    // Set-Cookie directly onto it. This test asserts that contract:
    // getSessionFor is called with the response that's actually
    // returned, NOT with a separate cookie store.
    vi.mocked(auth).mockResolvedValueOnce({ accessToken: "idp-jwt" } as never);
    const session = makeSession({});
    vi.mocked(getSessionFor).mockResolvedValueOnce(session as never);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: "alice@example.com", scopes: ["read"] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await GET(makeReq("cluster=default"));

    // The second arg to getSessionFor must be the same response we
    // return — that's what makes Set-Cookie reach the browser.
    expect(getSessionFor).toHaveBeenCalledOnce();
    const [, passedResponse] = vi.mocked(getSessionFor).mock.calls[0] ?? [];
    expect(passedResponse).toBe(res);
  });
});
