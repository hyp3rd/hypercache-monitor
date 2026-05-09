"use client";

import { Button } from "@/components/ui/button";
import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

/**
 * Theme toggle. We MUST gate the icon render on a hydration
 * check: `next-themes` resolves the active theme client-side
 * (it reads `localStorage.theme` before React hydrates), so a
 * naive `useTheme()` render produces a server tree that paints
 * Moon (default) and a client tree that paints Sun (resolved
 * from storage) — classic hydration mismatch.
 *
 * `useSyncExternalStore` is the React-19-blessed answer to "am
 * I rendering on the client?": the server snapshot is `false`,
 * the client snapshot is `true`, and there's no setState in an
 * effect body (which would trigger React's
 * `react-hooks/set-state-in-effect` rule).
 *
 * The empty subscriber is intentional — we never need to
 * notify, the snapshot is constant per environment.
 *
 * See https://nextjs.org/docs/messages/react-hydration-error
 * and the next-themes README's "Avoid Hydration Mismatch"
 * section.
 */
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function ThemeToggle() {
  const hydrated = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
  const { resolvedTheme, setTheme } = useTheme();

  // Pre-hydration placeholder: same `<button>` shape as the
  // live toggle, no icon (so neither server nor client can
  // disagree about which one to paint). `aria-hidden` because
  // the button is not yet interactive.
  if (!hydrated) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-hidden
        disabled
        className="opacity-0"
      >
        <span className="h-4 w-4" />
      </Button>
    );
  }

  const dark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? (
        <Sun
          aria-hidden
          className="h-4 w-4"
        />
      ) : (
        <Moon
          aria-hidden
          className="h-4 w-4"
        />
      )}
    </Button>
  );
}
