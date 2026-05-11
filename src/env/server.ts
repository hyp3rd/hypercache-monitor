/**
 * Server-only environment validation. Imported by API routes,
 * server components, and the iron-session config. Never imported
 * from client components — the bundler would refuse, but the
 * `import "server-only"` guard makes the failure mode loud.
 *
 * AGENTS.md §5.3 mandates zod-validated env. Raw `process.env.X`
 * scattered through the code is a forbidden pattern.
 */
import "server-only";
import { z } from "zod";

const schema = z
  .object({
    // Cluster registry source. EITHER set HYPERCACHE_MONITOR_CLUSTERS
    // to a YAML file path (multi-cluster, recommended) OR set the
    // legacy single-cluster env vars below. The cluster loader
    // (`src/lib/clusters/loader.ts`) enforces "at least one is
    // configured" and prefers YAML when both are set.
    HYPERCACHE_MONITOR_CLUSTERS: z
      .string()
      .optional()
      .describe(
        "Path to a YAML file defining the cluster registry (see clusters.example.yaml). " +
          "When set, this overrides HYPERCACHE_API_URL/HYPERCACHE_MGMT_URL.",
      ),

    // Single-cluster fallback. Optional for back-compat with Phase A
    // / B deployments — the loader synthesizes a `default` cluster
    // from these when HYPERCACHE_MONITOR_CLUSTERS is absent. New
    // deployments should prefer the YAML registry.
    HYPERCACHE_API_URL: z
      .string()
      .url()
      .optional()
      .describe(
        "Single-cluster fallback: client API base URL (e.g. http://cache:8080)",
      ),
    HYPERCACHE_MGMT_URL: z
      .string()
      .url()
      .optional()
      .describe(
        "Single-cluster fallback: management HTTP base URL (e.g. http://cache:8081)",
      ),

    // iron-session secret for sealing the auth cookie. Must be at
    // least 32 chars per iron-session's own validation. Generate via
    // `openssl rand -base64 48` and ship as a k8s secret.
    IRON_SESSION_SECRET: z
      .string()
      .min(
        32,
        "IRON_SESSION_SECRET must be >=32 chars; generate with `openssl rand -base64 48`",
      ),

    // Cookie name; override only when running multiple instances
    // on the same hostname. Defaults to `hcm_session`.
    IRON_SESSION_COOKIE_NAME: z.string().default("hcm_session"),

    // NODE_ENV is set by Next.js itself; we read it for cookie
    // `secure: true` in production and CSRF strictness.
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    // Phase C OIDC. When AUTH_OIDC_ISSUER + AUTH_OIDC_CLIENT_ID +
    // AUTH_OIDC_CLIENT_SECRET + AUTH_SECRET are set, the monitor
    // exposes a "Sign in with <provider>" button on /login that
    // initiates the OIDC redirect flow via auth.js v5. The post-
    // callback flow seals the operator's IdP-issued access token
    // into the same iron-session shape as the existing static-
    // bearer login. Single-IdP-across-all-clusters by design;
    // per-cluster federation is a deliberate non-goal for v1.
    //
    // Partial config (some but not all required fields) is
    // rejected by the superRefine below — silent partial config
    // would render an OIDC button that 500s the moment an
    // operator clicks it.
    AUTH_OIDC_ISSUER: z
      .string()
      .url()
      .optional()
      .describe(
        "OIDC IdP issuer URL (the discovery doc lives at <issuer>/.well-known/openid-configuration).",
      ),
    AUTH_OIDC_CLIENT_ID: z
      .string()
      .min(1)
      .optional()
      .describe("OAuth2 client ID registered at the IdP."),
    AUTH_OIDC_CLIENT_SECRET: z
      .string()
      .min(1)
      .optional()
      .describe("OAuth2 client secret registered at the IdP."),
    AUTH_OIDC_SCOPES: z
      .string()
      .default("openid profile email")
      .describe(
        "Space-separated scopes requested at /authorize. Standard OIDC: openid profile email.",
      ),
    AUTH_OIDC_PROVIDER_NAME: z
      .string()
      .default("Identity Provider")
      .describe(
        "Display name for the OIDC provider in the login UI ('Sign in with <name>').",
      ),
    AUTH_SECRET: z
      .string()
      .min(
        32,
        "AUTH_SECRET must be >=32 chars; generate with `openssl rand -base64 48`",
      )
      .optional()
      .describe(
        "auth.js JWT-session signing secret. Required when OIDC is enabled.",
      ),
    AUTH_URL: z
      .string()
      .url()
      .optional()
      .describe(
        "Canonical public URL of the monitor (e.g. https://monitor.example.com). " +
          "Required when AUTH_OIDC_ISSUER is set AND NODE_ENV=production — auth.js uses it to build the OIDC redirect_uri sent to the IdP. " +
          "Without it, auth.js falls back to the request `Host` header, which is the listener bind address (`0.0.0.0:3000`) under Next.js standalone mode.",
      ),
  })
  .superRefine((env, ctx) => {
    // Partial OIDC config is fail-fast. Either every required field
    // is set (OIDC enabled) or none are (OIDC disabled). The flag
    // for "enabled" is AUTH_OIDC_ISSUER's presence; everything else
    // becomes required when issuer is set.
    if (env.AUTH_OIDC_ISSUER === undefined) {
      return;
    }

    const required: Array<[string, string | undefined]> = [
      ["AUTH_OIDC_CLIENT_ID", env.AUTH_OIDC_CLIENT_ID],
      ["AUTH_OIDC_CLIENT_SECRET", env.AUTH_OIDC_CLIENT_SECRET],
      ["AUTH_SECRET", env.AUTH_SECRET],
    ];

    for (const [name, value] of required) {
      if (value === undefined || value === "") {
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: `${name} is required when AUTH_OIDC_ISSUER is set (OIDC enabled)`,
        });
      }
    }

    // AUTH_URL is required in production when OIDC is enabled. In
    // dev (NODE_ENV=development|test) auth.js's request-host fallback
    // works because the bind address matches the operator-visible
    // host (localhost:3000); the Docker example explicitly sets
    // AUTH_URL anyway. In production behind a proxy, the bind
    // address is the in-cluster service name and the operator-
    // visible host comes from AUTH_URL — without it, the IdP
    // redirect_uri is wrong and the OAuth dance breaks at the
    // very first redirect.
    if (env.NODE_ENV === "production" && env.AUTH_URL === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_URL"],
        message:
          "AUTH_URL is required in production when AUTH_OIDC_ISSUER is set; " +
          "set it to the canonical public URL of the monitor (e.g. https://monitor.example.com)",
      });
    }
  });

// `next build` runs page-data collection by importing every
// route module, which transitively reads `serverEnv.*` at the
// top level of `lib/auth/session.ts` and `lib/clusters/registry.ts`.
// The Docker image is built without runtime secrets — those are
// injected at deploy time — so a strict throw here breaks the
// image build. We skip validation in the build phase only; each
// production server process re-evaluates this module on startup
// (the build artifact is JS source, not a snapshot of module
// exports), at which point real env is present and validation
// runs as designed.
//
// `NEXT_PHASE` is set by the Next.js CLI; "phase-production-build"
// is the documented identifier for `next build` and is stable
// across the App Router lifecycle.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

function loadEnv(): z.infer<typeof schema> {
  if (isBuildPhase) {
    return process.env as unknown as z.infer<typeof schema>;
  }
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Fail-fast at module load. The Next.js server won't boot if
    // env is invalid — preferable to a silent runtime auth bypass.
    // The error message lists every failing field by name; values
    // are NOT included (could be a token or secret).
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment for hypercache-monitor:\n${issues}`);
  }
  return parsed.data;
}

export const serverEnv = loadEnv();
