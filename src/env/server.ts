import { z } from "zod";

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

const schema = z.object({
  // Phase A single-cluster shortcut. Phase C swaps to a
  // config file (HYPERCACHE_MONITOR_CLUSTERS=/etc/hypercache-monitor/clusters.yaml).
  HYPERCACHE_API_URL: z.string().url().describe("Client API base URL (e.g. http://cache:8080)"),
  HYPERCACHE_MGMT_URL: z.string().url().describe("Management HTTP base URL (e.g. http://cache:8081)"),

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
