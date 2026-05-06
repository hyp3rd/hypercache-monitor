// Flat ESLint config. eslint-config-next 16 ships native flat
// configs typed as `Linter.Config[]` — no FlatCompat shim
// needed. core-web-vitals already pulls in @next/next, react,
// react-hooks, and jsx-a11y rules; we extend with our own
// stricter jsx-a11y rules below if we ever need them.
//
// The control-panel target is Lighthouse a11y >= 95 (Phase A
// verification). The recommended jsx-a11y rules ship by
// default with core-web-vitals; this config inherits them.

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/lib/api/generated/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
];

export default config;
