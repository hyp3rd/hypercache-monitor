import { load } from "js-yaml";
import { readFileSync } from "node:fs";
import "server-only";
import { z } from "zod";
import type { Cluster } from "./types";

/**
 * Cluster registry loader — Phase C1.
 *
 * Two paths, picked at boot:
 *
 *   1. **YAML file** — `HYPERCACHE_MONITOR_CLUSTERS` points at a
 *      file. Parsed once into `Record<string, Cluster>`. Format
 *      is map-keyed-by-cluster-id (see `clusters.example.yaml`).
 *
 *   2. **Env-var fallback** — when no YAML path is configured
 *      AND `HYPERCACHE_API_URL` + `HYPERCACHE_MGMT_URL` are set,
 *      synthesize a single-entry `default` cluster. Preserves
 *      Phase A / B single-cluster deployments unchanged.
 *
 * If both are configured, YAML wins (with a warning logged at
 * boot — operators get a clear signal that the env vars are
 * being shadowed). If neither is configured, fail-fast at boot.
 *
 * Read-once-cache-forever: the file is parsed on first call and
 * cached. Operators restart the process to pick up cluster
 * config changes — same shape as every other env-driven
 * setting in the codebase.
 *
 * Why "server-only": YAML parsing pulls js-yaml; it's a server-
 * side concern. The browser receives only the projected list
 * (`ClusterListItem`) via server components.
 */

export const DEFAULT_CLUSTER_ID = "default";

// Hostname character set — bare hostname only (no scheme, no port,
// no path). Tighter than RFC 1123 because we use the value purely
// for case-insensitive equality against the request `Host` header
// and any garbage character would never match anyway.
const hostnameRegex = /^[a-z0-9.-]+$/;

const clusterEntrySchema = z.object({
  name: z.string().min(1, "cluster name is required"),
  apiBaseUrl: z.string().url("apiBaseUrl must be a valid URL"),
  mgmtBaseUrl: z.string().url("mgmtBaseUrl must be a valid URL"),
  // Phase C2: optional hostname allowlist. Used only by the /login
  // server component to preselect the cluster matching the request's
  // Host header. Never consulted in auth gates.
  hosts: z
    .array(
      z
        .string()
        .min(1, "host cannot be empty")
        .regex(
          hostnameRegex,
          "host must be a bare lowercase hostname (no scheme, no port)",
        ),
    )
    .optional(),
});

const clustersFileSchema = z
  .record(
    // Cluster IDs must be URL-safe — they appear in proxy paths
    // (`/api/clusters/[clusterId]/...`). Restricted character set
    // catches typos early.
    z
      .string()
      .min(1, "cluster id cannot be empty")
      .regex(/^[a-zA-Z0-9_-]+$/, "cluster id must match [a-zA-Z0-9_-]+"),
    clusterEntrySchema,
  )
  .refine((map) => Object.keys(map).length > 0, {
    message: "clusters file must define at least one cluster",
  })
  .superRefine((map, ctx) => {
    // Cross-cluster duplicate-host detection. Phase C2 routes the
    // /login default by Host header; ambiguous hosts make that
    // behavior undefined. Reject at parse time so the operator
    // sees a loud failure rather than a confusing UX where the
    // cluster preselected on a host depends on object key order.
    const seen = new Map<string, string>();
    for (const [clusterId, entry] of Object.entries(map)) {
      for (const host of entry.hosts ?? []) {
        const owner = seen.get(host);
        if (owner !== undefined) {
          ctx.addIssue({
            code: "custom",
            path: [clusterId, "hosts"],
            message: `host "${host}" is already claimed by cluster "${owner}"`,
          });
          continue;
        }
        seen.set(host, clusterId);
      }
    }
  });

export class ClusterLoaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClusterLoaderError";
  }
}

interface LoaderInput {
  clustersPath: string | undefined;
  apiUrl: string | undefined;
  mgmtUrl: string | undefined;
  /** Logger for boot-time warnings. Test seam — defaults to console.warn. */
  warn?: (message: string) => void;
  /** File reader. Test seam — defaults to fs.readFileSync. */
  readFile?: (path: string) => string;
}

/**
 * Loads the cluster registry from the configured source. Returns
 * a frozen map so accidental mutation downstream throws loudly.
 *
 * Throws `ClusterLoaderError` on:
 *   - YAML parse failure
 *   - Schema validation failure (zod)
 *   - Missing file (when path is set)
 *   - Neither YAML nor env vars configured
 *
 * Pure (modulo `readFile`/`warn` seams) so it tests cleanly.
 */
export function loadClusters(input: LoaderInput): Record<string, Cluster> {
  const { clustersPath, apiUrl, mgmtUrl } = input;
  const warn = input.warn ?? ((m: string) => console.warn(m));
  const readFile = input.readFile ?? ((p: string) => readFileSync(p, "utf-8"));

  if (clustersPath !== undefined && clustersPath !== "") {
    if (apiUrl !== undefined || mgmtUrl !== undefined) {
      warn(
        "[clusters] Both HYPERCACHE_MONITOR_CLUSTERS and HYPERCACHE_API_URL/HYPERCACHE_MGMT_URL are set; " +
          "YAML wins, env vars are ignored. Unset the env vars to silence this warning.",
      );
    }
    return parseYamlFile(clustersPath, readFile);
  }

  if (
    apiUrl !== undefined &&
    apiUrl !== "" &&
    mgmtUrl !== undefined &&
    mgmtUrl !== ""
  ) {
    return Object.freeze({
      [DEFAULT_CLUSTER_ID]: {
        id: DEFAULT_CLUSTER_ID,
        name: "Local cluster",
        apiBaseUrl: apiUrl,
        mgmtBaseUrl: mgmtUrl,
      },
    }) satisfies Record<string, Cluster>;
  }

  throw new ClusterLoaderError(
    "no cluster registry configured: set HYPERCACHE_MONITOR_CLUSTERS to a YAML path, " +
      "or set both HYPERCACHE_API_URL and HYPERCACHE_MGMT_URL for the single-cluster fallback",
  );
}

function parseYamlFile(
  path: string,
  readFile: (p: string) => string,
): Record<string, Cluster> {
  let text: string;
  try {
    text = readFile(path);
  } catch (err) {
    throw new ClusterLoaderError(
      `failed to read clusters file at ${path}: ${(err as Error).message}`,
    );
  }

  let raw: unknown;
  try {
    raw = load(text);
  } catch (err) {
    throw new ClusterLoaderError(
      `failed to parse clusters YAML at ${path}: ${(err as Error).message}`,
    );
  }

  const parsed = clustersFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new ClusterLoaderError(
      `invalid clusters YAML at ${path}:\n${issues}`,
    );
  }

  // Project each entry to the full `Cluster` shape (id is the
  // map key, not duplicated as a field in the YAML).
  const out: Record<string, Cluster> = {};
  for (const [id, entry] of Object.entries(parsed.data)) {
    out[id] = { id, ...entry };
  }
  return Object.freeze(out);
}
