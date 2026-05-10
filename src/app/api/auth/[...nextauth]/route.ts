import { handlers, isOIDCEnabled } from "@/lib/auth/oidc";
import { type NextRequest, NextResponse } from "next/server";

/**
 * auth.js v5 mount point. Next.js App Router matches static
 * segments (`/api/auth/login`, `/api/auth/logout`,
 * `/api/auth/switch-cluster`, `/api/auth/oidc-callback`) before
 * this catch-all, so the existing literal routes keep their
 * behavior intact — auth.js only handles paths under
 * `/api/auth/<sign-in/sign-out/callback/csrf/...>` that have no
 * literal counterpart.
 *
 * When OIDC is disabled (no AUTH_OIDC_ISSUER), every catch-all
 * path 404s rather than crashing — auth.js's handler isn't
 * constructed, so we render a generic "auth disabled" response.
 * This keeps the build clean for deployments that haven't opted
 * into OIDC.
 */

export async function GET(req: NextRequest): Promise<Response> {
  if (!isOIDCEnabled) {
    return NextResponse.json(
      { error: "OIDC not configured", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  return handlers.GET(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!isOIDCEnabled) {
    return NextResponse.json(
      { error: "OIDC not configured", code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  return handlers.POST(req);
}
