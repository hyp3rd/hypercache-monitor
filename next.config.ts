import type { NextConfig } from "next";

// Next.js basePath is read from BASE_URL at build time. The Dockerfile
// passes `--build-arg BASE_URL=/web` for OpenShift sub-path routing;
// the default "/" makes basePath an empty string (Next's required form).
const baseURL = process.env.BASE_URL ?? "/";
const basePath = baseURL === "/" ? "" : baseURL.replace(/\/$/, "");

const config: NextConfig = {
  // Standalone output is what the Dockerfile copies into the runtime
  // image. Without this, `next build` produces a server bundle that
  // requires the full node_modules tree at runtime — too heavy for
  // a container image.
  output: "standalone",

  basePath,

  // The proxy layer is server-only; never expose any non-NEXT_PUBLIC_*
  // env vars to the browser. React strict-mode catches double-render
  // bugs early — keep on.
  reactStrictMode: true,

  // Typed routes (Next 16): every Link href is typechecked against
  // the actual route tree. Catches typos and stale hrefs at build time.
  typedRoutes: true,

  // The dist transport's response shapes change with the cache repo's
  // releases; turning typechecks off would let the codegen drift go
  // silent. Keep typed-build behavior — typecheck failures fail the
  // build. (Next 16 removed the legacy `eslint.ignoreDuringBuilds`
  // option; lint runs as a separate `npm run lint` step in `make ci`.)
  typescript: { ignoreBuildErrors: false },
};

export default config;
