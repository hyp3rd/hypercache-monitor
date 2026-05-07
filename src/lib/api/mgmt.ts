import { z } from "zod";

/**
 * Hand-written zod schemas + fetcher for the HyperCache
 * **management HTTP** routes (port 8081). The mgmt port has no
 * OpenAPI spec — these schemas mirror what
 * `management_http.go::mountRoutes` registers in the cache repo.
 *
 * The shapes here are the contract. A CI integration test (Phase
 * A verification) hits a live cluster and asserts these schemas
 * still parse — when the Go side adds a field, the test fails
 * loud and this wrapper updates explicitly. Never silently
 * widen a schema to match a renamed field; that's where shadow-API
 * divergence starts (per plan §"Stopping conditions").
 *
 * Phase A only uses /cluster/members, /cluster/ring,
 * /cluster/heartbeat — schemas for the rest stay defined for
 * Phase B but unused here.
 */

export const memberStateSchema = z.enum(["alive", "suspect", "dead", "draining"]);
export type MemberState = z.infer<typeof memberStateSchema>;

// Wire field names are PascalCase because the cache's
// `hypercache_dist.go::DistMembershipSnapshot` returns an
// anonymous struct without `json:` tags, so Go's default JSON
// marshaling exposes the struct field names verbatim.
//
// We normalize on the parse step: zod accepts the wire shape and
// transforms into the camelCase shape every UI component reads.
// That keeps the component code idiomatic JS/TS without leaking
// the Go convention through the whole UI tree.
const memberWireSchema = z.object({
  ID: z.string(),
  Address: z.string(),
  State: memberStateSchema,
  Incarnation: z.number().int(),
});

export const memberSchema = memberWireSchema.transform((m) => ({
  id: m.ID,
  address: m.Address,
  state: m.State,
  incarnation: m.Incarnation,
}));
export type Member = z.infer<typeof memberSchema>;

export const clusterMembersSchema = z.object({
  replication: z.number().int(),
  virtualNodes: z.number().int(),
  members: z.array(memberSchema),
});
export type ClusterMembers = z.infer<typeof clusterMembersSchema>;

// Ring vnodes are flat `"hash:ownerId"` strings (see
// `pkg/backend/dist_memory.go::DistRingHashSpots returning
// []string`). We split on the rightmost `:` so node IDs that
// contain colons (unlikely but legal) survive the round-trip.
export const vnodeSchema = z.string().transform((s, ctx) => {
  const idx = s.lastIndexOf(":");
  if (idx < 0) {
    ctx.addIssue({ code: "custom", message: `vnode missing ":" separator: ${s}` });
    return z.NEVER;
  }
  return {
    hash: s.slice(0, idx),
    ownerId: s.slice(idx + 1),
  };
});
export type Vnode = z.infer<typeof vnodeSchema>;

export const clusterRingSchema = z.object({
  count: z.number().int(),
  vnodes: z.array(vnodeSchema),
});
export type ClusterRing = z.infer<typeof clusterRingSchema>;

// Heartbeat metrics shape comes from
// `hypercache_dist.go::DistHeartbeatMetrics` — a `map[string]any`
// with explicit string keys, hence the camelCase wire shape.
// Fields are optional because the cache returns nil when the
// backend isn't a DistMemory; we want to render "no data"
// gracefully in that case.
export const heartbeatSchema = z
  .object({
    heartbeatSuccess: z.number().int().nonnegative().optional(),
    heartbeatFailure: z.number().int().nonnegative().optional(),
    nodesRemoved: z.number().int().nonnegative().optional(),
    readPrimaryPromote: z.number().int().nonnegative().optional(),
  })
  // Permissive on additional fields — the cache may grow this
  // map over time. Integration test (Phase A verification)
  // catches when a known key disappears.
  .passthrough();
export type Heartbeat = z.infer<typeof heartbeatSchema>;

const errorEnvelope = z.object({
  error: z.string(),
  code: z.string(),
});

/**
 * proxiedMgmt builds the URL path the proxy expects: every
 * request goes through the Next.js layer at
 * `/api/clusters/{clusterId}/mgmt/...`. Callers pass just the
 * trailing path, e.g. `cluster/members`.
 */
export function mgmtPath(clusterId: string, path: string): string {
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  return `/api/clusters/${encodeURIComponent(clusterId)}/mgmt/${trimmed}`;
}

/**
 * fetchMgmt is the canonical fetcher used by every mgmt-route
 * TanStack Query hook. Validates the response with the supplied
 * schema; throws a typed error on parse failure that the
 * `<QueryError/>` component renders. Cookies travel automatically
 * (same-origin proxy fetch) so no Authorization header is set
 * here — the proxy injects it from the iron-session.
 */
export async function fetchMgmt<T>(
  clusterId: string,
  path: string,
  schema: z.ZodSchema<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(mgmtPath(clusterId, path), {
    ...init,
    headers: { ...(init?.headers ?? {}), accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const env = errorEnvelope.safeParse(body);
    const message = env.success ? env.data.error : `HTTP ${response.status}`;
    const err = new Error(message) as Error & { status?: number; code?: string };
    err.status = response.status;
    if (env.success) err.code = env.data.code;
    throw err;
  }

  const json = await response.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`mgmt response shape mismatch at ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}
