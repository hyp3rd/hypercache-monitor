import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OidcSignInButton } from "./oidc-sign-in-button";

/**
 * Pins the OIDC sign-in button's call into auth.js v5's
 * client `signIn` helper:
 *   - clicked → signIn("oidc", { callbackUrl })
 *   - the callbackUrl encodes the cluster id so the post-
 *     callback handler knows which cluster to bind
 *
 * A regression in the callbackUrl (missing cluster, wrong path,
 * raw unencoded id) would break the OIDC flow at the post-IdP
 * redirect step — no E2E without this gate.
 */
const signInMock = vi.fn();
vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
}));

describe("OidcSignInButton", () => {
  it("renders 'Sign in with <provider>' label", () => {
    render(<OidcSignInButton providerName="Acme SSO" />);
    expect(screen.getByText(/Sign in with Acme SSO/)).toBeDefined();
  });

  it("calls signIn('oidc', ...) with default callbackUrl when no cluster is preselected", () => {
    signInMock.mockReset();
    render(<OidcSignInButton providerName="Acme SSO" />);
    fireEvent.click(screen.getByRole("button"));
    expect(signInMock).toHaveBeenCalledWith("oidc", {
      callbackUrl: "/api/auth/oidc-callback",
    });
  });

  it("encodes the preselected cluster into the callbackUrl", () => {
    signInMock.mockReset();
    render(
      <OidcSignInButton
        providerName="Acme SSO"
        preselectedClusterId="prod-east"
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(signInMock).toHaveBeenCalledWith("oidc", {
      callbackUrl: "/api/auth/oidc-callback?cluster=prod-east",
    });
  });

  it("URL-encodes special characters in the cluster id", () => {
    // Cluster ids in the registry are constrained to [a-zA-Z0-9_-]
    // by the loader, but the button should not rely on the caller
    // having validated. Defense-in-depth: encode whatever arrives
    // before it lands in the URL.
    signInMock.mockReset();
    render(
      <OidcSignInButton
        providerName="X"
        preselectedClusterId="weird id&with=chars"
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(signInMock).toHaveBeenCalledWith("oidc", {
      callbackUrl: `/api/auth/oidc-callback?cluster=${encodeURIComponent(
        "weird id&with=chars",
      )}`,
    });
  });
});
