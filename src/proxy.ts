import { sessionOptions, type SessionData } from "@/lib/auth/session";
import { getIronSession } from "iron-session";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Next.js 16 **edge proxy** (formerly `middleware.ts`). Renamed
 * per the Next 16 convention so the file name better describes
 * what it does — sit at the network boundary in front of the app.
 *
 * Gates the `(app)` group behind an iron-session cookie: when
 * `activeClusterId` is missing, redirects to `/login`. The
 * `/login`, `/api/auth/*`, and static asset paths are
 * intentionally NOT in `config.matcher` — they have to be
 * reachable pre-login.
 *
 * NB: this file is distinct from `src/lib/api/proxy.ts`, which
 * forwards already-authenticated requests to the upstream
 * HyperCache cluster. The two files share a noun ("proxy") but
 * sit at different layers — this one lives at the Edge runtime
 * and runs on every request before any route handler; the other
 * runs inside route handlers and talks to the cache.
 */
export async function proxy(req: NextRequest) {
  const res = NextResponse.next();
  // iron-session's NextRequest/NextResponse overload threads
  // cookies through both sides — read validates the sealed
  // cookie, write would persist mutations (this proxy reads
  // only).
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  if (!session.activeClusterId) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  // Protect every authenticated surface. The `(app)` group
  // segment doesn't appear in URLs (it's a parens grouping), so
  // we list the surface paths directly. New surfaces in Phase B
  // must be added here.
  matcher: [
    "/topology/:path*",
    "/keys/:path*",
    "/metrics/:path*",
    "/bulk/:path*",
    "/auth-info/:path*",
    "/spec/:path*",
  ],
};
