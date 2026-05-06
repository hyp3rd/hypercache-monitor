import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Vitest config for unit + component tests. E2E lives in
// `playwright.config.ts`. The `src/lib/api/generated` tree is
// codegen output — we exclude it so a regenerate doesn't trip
// stale-snapshot tests.

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
        "**/*.config.{ts,mjs}",
      ],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
