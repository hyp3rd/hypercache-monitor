import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vitest config for unit + component tests. E2E lives in
// `playwright.config.ts`. The `src/lib/api/generated` tree is
// codegen output — we exclude it so a regenerate doesn't trip
// stale-snapshot tests.
//
// `.mts` (not `.ts`): the package has no `"type": "module"`, so a
// `.ts` config is loaded as CommonJS and Vite warns that its ESM
// syntax won't survive the upcoming `configLoader: 'native'`
// default. The explicit ESM extension sidesteps that without
// flipping module semantics for every other config in the repo.
// `import.meta.dirname` replaces `__dirname`, which the native
// loader won't shim (Node >= 20.11 / 22 provides it).

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "node_modules/**",
      ".next/**",
      "src/lib/api/generated/**",
      "tests/e2e/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: [
        "src/lib/api/generated/**",
        "src/app/**/page.tsx",
        "src/app/**/layout.tsx",
        "**/*.config.{ts,mts,mjs}",
      ],
    },
    // next-auth v5 uses Node's package-self-resolution
    // (`import "next/server"`) inside node_modules. Vitest's
    // dependency-externalization layer skips alias resolution
    // for ESM externals; inlining next-auth pulls it through
    // Vite's transformer so our `next/server` alias above
    // takes effect.
    server: { deps: { inline: ["next-auth", "@auth/core"] } },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      // Next.js `import "server-only"` is a compile-time guard
      // that doesn't exist as a real module. Alias to an empty
      // stub so tests can exercise server-only code without the
      // resolver erroring.
      "server-only": resolve(
        import.meta.dirname,
        "./src/test/server-only-stub.ts",
      ),
      // next-auth v5 (and other libraries) import `next/server`
      // bare — Next.js's package self-resolution turns that into
      // `./server.js` at runtime, but Vitest's resolver doesn't
      // implement self-references. Alias to the `.js` file so
      // imports of NextRequest/NextResponse etc. resolve cleanly.
      "next/server": resolve(
        import.meta.dirname,
        "./node_modules/next/server.js",
      ),
    },
  },
});
