import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { baseFromHost } from "./host-base";

/**
 * Pins the resolution order documented on baseFromHost:
 *
 *   X-Forwarded-Host (proxied) > Host (direct) > req.nextUrl.host (fallback)
 *
 * Same rule for protocol via X-Forwarded-Proto. The fallback exists
 * for completeness — no real HTTP/1.1 client omits the Host header
 * — but `req.nextUrl.host` is exactly the bad value (typically
 * `0.0.0.0:3000` on Next 16 standalone) that the helper exists to
 * step around. We test it last so a caller eyeballing the suite
 * sees the priority chain top-down.
 */

function makeReq(
  url: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(new URL(url), { headers });
}

describe("baseFromHost", () => {
  it("uses Host header when X-Forwarded-Host is absent", () => {
    const req = makeReq("http://0.0.0.0:3000/api/auth/oidc-callback", {
      host: "monitor.example.com",
    });
    const base = baseFromHost(req);
    expect(base.host).toBe("monitor.example.com");
    expect(base.protocol).toBe("http:");
  });

  it("prefers X-Forwarded-Host over Host (proxied deployment)", () => {
    const req = makeReq("http://0.0.0.0:3000/api/auth/oidc-callback", {
      host: "internal.k8s.svc",
      "x-forwarded-host": "monitor.example.com",
      "x-forwarded-proto": "https",
    });
    const base = baseFromHost(req);
    expect(base.host).toBe("monitor.example.com");
    expect(base.protocol).toBe("https:");
  });

  it("falls back to req.nextUrl.host when no Host headers are set", () => {
    // Constructing a NextRequest without any explicit Host header
    // surfaces the request URL's host. Real HTTP/1.1 clients always
    // send Host; this branch exists for type safety + the case
    // where a synthetic request is constructed in code paths that
    // bypass the network entirely.
    const req = new NextRequest(new URL("http://standby.local:9999/x"));
    const base = baseFromHost(req);
    expect(base.host).toBe("standby.local:9999");
  });

  it("derives protocol from req.nextUrl when X-Forwarded-Proto is absent", () => {
    const req = makeReq("https://0.0.0.0:3000/x", {
      host: "monitor.example.com",
    });
    const base = baseFromHost(req);
    expect(base.protocol).toBe("https:");
  });

  it("returns a same-origin base; relative paths resolve against it", () => {
    // Smoke check the actual call-site shape: callers do
    // `new URL("/topology", baseFromHost(req))`. The path resolution
    // must hit the operator-visible host.
    const req = makeReq("http://0.0.0.0:3000/api/auth/oidc-callback", {
      host: "localhost:3000",
    });
    const target = new URL("/topology", baseFromHost(req));
    expect(target.href).toBe("http://localhost:3000/topology");
  });
});
