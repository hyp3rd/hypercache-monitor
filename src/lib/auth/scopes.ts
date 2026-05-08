import type { Scope } from "@/lib/auth/session";

/**
 * Operator-facing description of each cache scope. Lives separate
 * from `session.ts` so non-server code (page client components,
 * tests) can import it without dragging the iron-session machinery
 * along.
 *
 * Source of truth for the action-list is the cache's HTTP route
 * registration in `cmd/hypercache-server/main.go` —
 * `read`/`write`/`admin` middleware wrappers gate the public client
 * API endpoints, and `admin` gates the destructive mgmt-port
 * controls (/evict, /clear, /trigger-expiration).
 *
 * Updating this catalog when the cache adds a new scope is required
 * — the unit test enforces that every scope in the union has a
 * catalog entry, so a typo or stale entry surfaces at gate time.
 */

export interface ScopeDescriptor {
  /** Short human-readable label rendered as the chip text. */
  label: string;
  /** One-line summary of what this scope grants. */
  summary: string;
  /**
   * Concrete actions this scope unlocks. Operator-facing wording —
   * "Fetch keys" rather than "GET /v1/cache/{key}". Phrasing
   * mirrors what an audit log would say.
   */
  actions: string[];
}

export const scopeCatalog: Record<Scope, ScopeDescriptor> = {
  read: {
    label: "Read",
    summary: "Inspect cache state without modifying it.",
    actions: [
      "Fetch keys (single + batch)",
      "View key metadata (TTL, version, owners)",
      "List cluster members and ring distribution",
      "View metrics, stats, and configuration",
    ],
  },
  write: {
    label: "Write",
    summary: "Mutate keys (store, delete) on top of read.",
    actions: [
      "Store keys (single + batch CSV import)",
      "Delete keys (single + batch with confirmation)",
      "Update existing keys (PUT against existing key is the same operation as create)",
    ],
  },
  admin: {
    label: "Admin",
    summary: "Cluster-wide destructive operations.",
    actions: [
      "Trigger eviction sweep (POST /evict)",
      "Trigger expiration sweep (POST /trigger-expiration)",
      "Clear the entire cache (POST /clear) — irreversible",
    ],
  },
};

/**
 * Returns the catalog entry for a scope. Centralized so a future
 * scope addition surfaces here as a TS error if `scopeCatalog`
 * isn't updated in lockstep.
 */
export function describeScope(scope: Scope): ScopeDescriptor {
  return scopeCatalog[scope];
}
