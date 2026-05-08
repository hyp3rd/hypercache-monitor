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

const schema = z.object({
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
    .describe("Single-cluster fallback: client API base URL (e.g. http://cache:8080)"),
  HYPERCACHE_MGMT_URL: z
    .string()
    .url()
    .optional()
    .describe("Single-cluster fallback: management HTTP base URL (e.g. http://cache:8081)"),

  // iron-session secret for sealing the auth cookie. Must be at
  // least 32 chars per iron-session's own validation. Generate via
  // `openssl rand -base64 48` and ship as a k8s secret.
  IRON_SESSION_SECRET: z
    .string()
    .min(32, "IRON_SESSION_SECRET must be >=32 chars; generate with `openssl rand -base64 48`"),

  // Cookie name; override only when running multiple instances
  // on the same hostname. Defaults to `hcm_session`.
  IRON_SESSION_COOKIE_NAME: z.string().default("hcm_session"),

  // NODE_ENV is set by Next.js itself; we read it for cookie
  // `secure: true` in production and CSRF strictness.
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment for hypercache-monitor:\n${issues}`);
  }
  return parsed.data;
}

export const serverEnv = loadEnv();
