import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub minimum env for the session module that proxy.ts imports.
// The mocks below replace iron-session entirely, but the module
// graph still evaluates `serverEnv` at import time.
process.env.IRON_SESSION_SECRET = "x".repeat(48);
process.env.HYPERCACHE_API_URL ??= "http://cache:8080";
process.env.HYPERCACHE_MGMT_URL ??= "http://cache:8081";

/**
 * Pins the edge proxy's two branches:
 *
 *   1. unauthenticated request → 307 redirect to /login built from
 *      the request's `Host` header (NOT `req.nextUrl`, which carries
 *      the listener bind address `0.0.0.0:3000` under Next.js
 *      standalone — see src/lib/url/host-base.ts for the rationale).
 *   2. authenticated request → NextResponse.next() with the iron-
 *      session cookie state preserved.
 *
 * The Host-header branch is the regression guard for the
 * `0.0.0.0`-redirect bug we hit in the OIDC docker stack — a
 * future refactor that resurrects `req.nextUrl.clone()` would put
 * unauthenticated operators on the wrong cookie scope.
 */

vi.mock("iron-session", () => ({ getIronSession: vi.fn() }));

const { getIronSession } = await import("iron-session");
const { proxy } = await import("./proxy");

beforeEach(() => {
  vi.mocked(getIronSession).mockReset();
});

function makeReq(
  url: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(new URL(url), { headers });
}

describe("edge proxy", () => {
  it("redirects unauthenticated requests to /login on the operator-visible host", async () => {
    vi.mocked(getIronSession).mockResolvedValueOnce({} as unknown as never);

    // Simulate the docker-stack shape: bind address shows up in
    // req.nextUrl, but Host carries the canonical hostname.
    const req = makeReq("http://0.0.0.0:3000/topology", {
      host: "monitor.example.com",
    });

    const res = await proxy(req);

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toBe("http://monitor.example.com/login");
  });

  it("uses X-Forwarded-Host when behind a proxy (k8s ingress / nginx)", async () => {
    vi.mocked(getIronSession).mockResolvedValueOnce({} as unknown as never);

    const req = makeReq("http://internal.k8s.svc/topology", {
      host: "internal.k8s.svc",
      "x-forwarded-host": "monitor.example.com",
      "x-forwarded-proto": "https",
    });

    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://monitor.example.com/login",
    );
  });

  it("passes through authenticated requests (NextResponse.next)", async () => {
    vi.mocked(getIronSession).mockResolvedValueOnce({
      activeClusterId: "default",
    } as unknown as never);

    const req = makeReq("http://localhost:3000/topology", {
      host: "localhost:3000",
    });

    const res = await proxy(req);

    // NextResponse.next() returns a 200; no Location header.
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
