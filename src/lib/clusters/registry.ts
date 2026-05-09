import { serverEnv } from "@/env/server";
import { unwatchFile, watchFile } from "node:fs";
import "server-only";
import { DEFAULT_CLUSTER_ID, loadClusters } from "./loader";
import type { Cluster } from "./types";

/**
 * Cluster registry. Phase C1 introduced the YAML loader; Phase C2
 * makes the registry **live-reloadable** so operators can edit
 * `clusters.yaml` and have the monitor pick up changes within the
 * polling interval — no process restart needed.
 *
 * Public API (`getCluster`, `listClusters`, `DEFAULT_CLUSTER_ID`)
 * is unchanged. Callers continue to invoke the getters per request,
 * so they automatically read the latest state after an atomic swap.
 *
 * **Why poll, not event-watch:** `fs.watch` is unreliable across
 * editor save patterns (vim's rename-replace, kubectl ConfigMap
 * remount, Helm rollouts). `fs.watchFile` is a stat-poll loop —
 * boring, slightly less timely (~2s), but ALWAYS picks up changes
 * regardless of how the file got rewritten.
 *
 * **Atomic-swap safety:** the holder is a single mutable
 * `current` reference. `getCluster` reads it on each call. Reassigning
 * `current` is a single statement; Node is single-threaded, so callers
 * either see the old map fully or the new map fully — never a mix.
 *
 * **Bad-YAML handling:** if a reload parse fails, we log to stderr
 * and **keep the previous valid registry**. The whole point of live
 * reload is that the operator can iterate without bringing the
 * monitor down — a typo in a YAML edit must not crash production.
 *
 * **Build-phase guard:** mirrors `src/env/server.ts`. `next build`
 * imports every page module to collect page data, which evaluates
 * this file. The Docker image is built without runtime config, so
 * a fail-fast load here breaks the image build. We return an empty
 * registry during the build phase; each production server process
 * re-evaluates this module on startup with real config present.
 *
 * **Hot-reload safety in dev:** Next.js's fast refresh re-evaluates
 * this module on every save in dev mode. Without a guard, each
 * re-eval would install a fresh watcher and leak the previous one.
 * `globalThis.__hypercacheClustersWatcher` parks the watched path
 * across reloads so we only watch once.
 */

const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

let current: Record<string, Cluster> = isBuildPhase
  ? {}
  : loadClusters({
      clustersPath: serverEnv.HYPERCACHE_MONITOR_CLUSTERS,
      apiUrl: serverEnv.HYPERCACHE_API_URL,
      mgmtUrl: serverEnv.HYPERCACHE_MGMT_URL,
    });

// Polling interval. 2s is long enough to amortize stat() overhead
// to nothing and short enough that an operator's edit feels live.
const WATCH_INTERVAL_MS = 2000;

interface WatcherSlot {
  path: string;
}

declare global {
  // Across Next.js dev hot-reloads, the `module` instance is fresh
  // but `globalThis` is preserved — perfect for one-time setup
  // markers like a watcher binding.
  var __hypercacheClustersWatcher: WatcherSlot | undefined;
}

if (!isBuildPhase && serverEnv.HYPERCACHE_MONITOR_CLUSTERS) {
  startWatching(serverEnv.HYPERCACHE_MONITOR_CLUSTERS);
}

function startWatching(path: string): void {
  const existing = globalThis.__hypercacheClustersWatcher;
  if (existing !== undefined) {
    if (existing.path === path) {
      // Already watching this exact path — common case on dev
      // hot-reload. Nothing to do.
      return;
    }
    // Path changed (rare — would mean env var changed mid-process,
    // which doesn't happen in practice). Drop the old watcher.
    unwatchFile(existing.path);
  }

  watchFile(
    path,
    { interval: WATCH_INTERVAL_MS, persistent: false },
    (curr, prev) => {
      // mtime equality means watchFile fired spuriously (poll
      // detected no real change). Skip — re-parsing identical
      // content would still succeed but burns CPU + log spam.
      if (curr.mtimeMs === prev.mtimeMs) {
        return;
      }
      reloadClusters(path);
    },
  );

  globalThis.__hypercacheClustersWatcher = { path };
}

function reloadClusters(path: string): void {
  let next: Record<string, Cluster>;
  try {
    next = loadClusters({
      clustersPath: path,
      // The fallback URLs are irrelevant on the reload path —
      // we know the YAML branch was active because that's the
      // only reason a watcher exists.
      apiUrl: undefined,
      mgmtUrl: undefined,
    });
  } catch (err) {
    // Bad YAML / removed file / permissions issue. Log loudly,
    // keep serving from the previous valid registry. Falling
    // through to crash here would defeat the live-reload purpose.
    console.error(
      `[clusters] reload failed for ${path}; keeping previous registry. cause: ${(err as Error).message}`,
    );
    return;
  }
  current = next;
  console.info(
    `[clusters] reloaded ${Object.keys(next).length} cluster(s) from ${path}`,
  );
}

export function getCluster(id: string): Cluster | undefined {
  return current[id];
}

export function listClusters(): Cluster[] {
  return Object.values(current);
}

/**
 * Test seam. Drives a reload from a unit-test-supplied path
 * without standing up a real fs.watchFile poller. Production
 * code never calls this — `startWatching` covers the live case.
 */
export function __test_reloadFromPath(path: string): void {
  reloadClusters(path);
}

/**
 * Test seam. Replaces the live registry with a hand-built map
 * so a unit test can simulate a reload without touching the
 * file system. Returns a restore function that swaps the
 * previous registry back; tests call it in `afterEach`.
 */
export function __test_setRegistry(next: Record<string, Cluster>): () => void {
  const prev = current;
  current = next;
  return () => {
    current = prev;
  };
}

export { DEFAULT_CLUSTER_ID };
