import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

/**
 * Destroys the iron-session cookie. Cookies are HMAC-sealed, so
 * a logout that just clears the cookie is sufficient — we don't
 * need a server-side blocklist.
 */
export async function POST(): Promise<Response> {
  const session = await getSession();
  session.destroy();
  return NextResponse.json({ ok: true });
}
