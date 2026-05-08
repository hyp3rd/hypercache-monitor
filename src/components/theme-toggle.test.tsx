import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeToggle } from "./theme-toggle";

/**
 * Theme toggle hydration-safety tests.
 *
 * The component uses `useSyncExternalStore` to gate the icon
 * render so SSR and CSR don't disagree before
 * `next-themes` has read `localStorage`. These tests pin that
 * gate by:
 *   - rendering the component on the server (renderToString)
 *     and asserting the placeholder shape
 *   - rendering the component in jsdom and asserting that
 *     after hydration, an actual sun/moon icon appears
 *
 * Without this coverage, a future "simplification" that drops
 * the useSyncExternalStore guard would silently re-introduce
 * the hydration mismatch the user already hit once.
 */

vi.mock("next-themes", () => ({
  // Default theme for both SSR and CSR is dark — but the
  // component must NOT call useTheme on the server path.
  useTheme: vi.fn(() => ({ resolvedTheme: "dark", setTheme: vi.fn() })),
}));

describe("ThemeToggle", () => {
  it("renders an opacity-0 placeholder on the server (no icon visible)", () => {
    const html = renderToString(<ThemeToggle />);
    // Placeholder is aria-hidden, opacity-0, and contains no
    // sun/moon SVG path data — the proof that we don't paint
    // a theme-dependent icon during SSR.
    expect(html).toContain("aria-hidden");
    expect(html).toContain("opacity-0");
    expect(html).not.toMatch(/lucide-sun/);
    expect(html).not.toMatch(/lucide-moon/);
  });

  it("renders an interactive toggle with a real icon on the client", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-label", expect.stringMatching(/Switch to (light|dark) mode/));
    // Icon SVG is present; client-side render unlocks the
    // real toggle behavior.
    expect(button.querySelector("svg")).not.toBeNull();
  });
});
