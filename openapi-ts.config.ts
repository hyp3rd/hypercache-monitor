import { defineConfig } from "@hey-api/openapi-ts";

/**
 * Hey API codegen for the HyperCache client API (port 8080).
 *
 * Default input: the cache repo's checked-in spec at the
 * sibling path. The cache repo guarantees binary-vs-spec
 * parity via its own `TestOpenAPISpecMatchesRoutes` drift
 * test (cmd/hypercache-server/openapi_test.go), so reading
 * from the file is operationally equivalent to fetching live
 * and works offline / in any CI runner that checks out both
 * repos.
 *
 * Override via `OPENAPI_INPUT` for:
 *   - `OPENAPI_INPUT=http://localhost:8080/v1/openapi.yaml` —
 *     pull from a running cluster (verifies the deployed
 *     binary's spec, not just the committed file).
 *   - `OPENAPI_INPUT=/abs/path/to/openapi.yaml` — different
 *     checkout layout.
 *
 * Generated output lives at `src/lib/api/generated/` and IS
 * committed. `npm run codegen:check` regenerates and fails on
 * any diff — that's the drift signal.
 */
export default defineConfig({
  input: process.env["OPENAPI_INPUT"] ?? "../hypercache/cmd/hypercache-server/openapi.yaml",
  output: {
    path: "src/lib/api/generated",
    // postProcess replaces the deprecated `format`/`lint` knobs.
    // Prettier only — generated code is mechanical output and
    // shouldn't be hand-edited or linted. The flat ESLint config
    // explicitly ignores `src/lib/api/generated/**` to keep CI
    // signal focused on hand-written code; passing it through
    // ESLint here would just trip that ignore rule.
    postProcess: ["prettier"],
  },
  plugins: [
    "@hey-api/client-fetch",
    "@tanstack/react-query",
    {
      name: "@hey-api/typescript",
      enums: "javascript",
    },
    {
      name: "@hey-api/sdk",
      // `byTags` groups generated SDK functions under their
      // OpenAPI tag (cache, batch, cluster, meta), matching how
      // the cache's spec organizes endpoints. The deprecated
      // `asClass: false` is replaced by this.
      operations: { strategy: "byTags" },
    },
  ],
});
