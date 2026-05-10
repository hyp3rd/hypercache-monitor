"use client";

import { Button } from "@/components/ui/button";
import { LogIn } from "lucide-react";
import { signIn } from "next-auth/react";

/**
 * OIDC sign-in button rendered above the existing token-paste
 * form when `AUTH_OIDC_ISSUER` is set. Clicking the button calls
 * auth.js's `signIn("oidc", ...)` helper, which handles the CSRF
 * dance + POSTs to `/api/auth/signin/oidc`. Auth.js redirects to
 * the IdP's authorize endpoint with the configured scopes.
 *
 * The `callbackUrl` carries the cluster id through the IdP
 * roundtrip — auth.js validates it's same-origin and redirects
 * back to the post-callback handler at /api/auth/oidc-callback,
 * which seals the access token into iron-session.
 *
 * Why `signIn()` rather than a plain `<a>`: auth.js v5 changed
 * GET /api/auth/signin/<provider> to render a sign-in page
 * rather than initiate the redirect. Only POST (with CSRF)
 * triggers the IdP redirect — `signIn()` is the supported
 * client API for that POST.
 */
export function OidcSignInButton({
  providerName,
  preselectedClusterId,
}: {
  providerName: string;
  preselectedClusterId?: string;
}) {
  const callbackUrl =
    preselectedClusterId !== undefined
      ? `/api/auth/oidc-callback?cluster=${encodeURIComponent(preselectedClusterId)}`
      : "/api/auth/oidc-callback";

  // void: signIn returns a Promise that resolves only on
  // failure (success redirects). React's onClick swallows
  // returned promises silently; explicit void marks intent.
  const onClick = () => {
    void signIn("oidc", { callbackUrl });
  };

  return (
    <Button
      type="button"
      variant="default"
      className="w-full gap-2"
      onClick={onClick}
    >
      <LogIn
        aria-hidden
        className="h-4 w-4"
      />
      Sign in with {providerName}
    </Button>
  );
}
