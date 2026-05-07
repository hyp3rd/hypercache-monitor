import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/lib/query/provider";
import { cn } from "@/lib/utils";
import type { Metadata, Viewport } from "next";
import { Roboto, Roboto_Mono, Roboto_Slab } from "next/font/google";
import "./globals.css";

// Self-host the Roboto family via next/font/google. Subset to
// latin so the bundle stays small. Weights are listed
// explicitly — works whether or not the source is a variable
// font, and gives reviewers a clear answer to "which weights
// are available."
//
//   Roboto       → --font-sans  → body, UI, table data
//   Roboto Slab  → --font-serif → headings (h1-h6) via globals.css
//   Roboto Mono  → --font-mono  → IDs, hashes, addresses, counters
//
// `display: "swap"` shows the system fallback during font load
// instead of holding the page invisible — better LCP.
const sans = Roboto({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-sans",
  display: "swap",
});

const slab = Roboto_Slab({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-serif",
  display: "swap",
});

const mono = Roboto_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "HyperCache Monitor",
    template: "%s · HyperCache Monitor",
  },
  description: "Operator control panel for HyperCache distributed cache clusters.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "white" },
    { media: "(prefers-color-scheme: dark)", color: "black" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn(sans.variable, slab.variable, mono.variable)}>
      <body className="bg-background min-h-screen font-sans antialiased">
        <ThemeProvider>
          <QueryProvider>
            {children}
            <Toaster />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
