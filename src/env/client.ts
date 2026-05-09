import { z } from "zod";

/**
 * Client-bundle environment. Only `NEXT_PUBLIC_*` env vars reach
 * the browser; everything else is filtered out by Next.js at
 * build time. Phase A has nothing client-visible — the proxy
 * means the browser never knows the cache's URL or token.
 *
 * Kept as a stub now so future client-only env (e.g. analytics
 * key, feature flags) has an obvious home. Don't sneak server
 * env through to the client by widening this schema.
 */

const schema = z.object({
  // Intentionally empty in Phase A.
});

const parsed = schema.safeParse({});

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid client environment:\n${issues}`);
}

export const clientEnv = parsed.data;
