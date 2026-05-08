"use client";

import type { ComponentProps, ReactNode } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Wrapper around `next-themes` so the rest of the app doesn't
 * import the third-party type. Default theme is "system" but
 * `defaultTheme: "dark"` overrides for new visitors — operators
 * mostly want dark; system-light is still respected when set.
 */
export function ThemeProvider({
  children,
  ...props
}: { children: ReactNode } & ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
