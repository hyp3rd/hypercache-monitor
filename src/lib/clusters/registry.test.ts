import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClusterLoaderError } from "./loader";
import type { Cluster } from "./types";

/**
 * Pins the Phase C2 live-reload registry behavior:
 *
 *   - successful reload swaps the registry atomically
 *   - failed reload (bad YAML, missing file) keeps the previous map
 *     and logs to stderr — never crashes
 *   - getter calls always read the latest reference
 *
 * Tests don't drive the real `fs.watchFile` poller; that's an OS-
 * level integration concern. Instead we mock `loadClusters` so each
 * test scripts what the loader returns (or throws), then drives a
 * reload through the `__test_reloadFromPath` seam — which feeds
 * the same code path a real watcher would. Hermetic, deterministic,
 * no temp files, no sleeps.
 */

vi.mock("./loader", async () => {
  const actual = await vi.importActual<typeof import("./loader")>("./loader");
  return { ...actual, loadClusters: vi.fn() };
});

vi.mock("@/env/server", () => ({
  serverEnv: {
    HYPERCACHE_MONITOR_CLUSTERS: "/tmp/test-clusters.yaml",
    HYPERCACHE_API_URL: undefined,
    HYPERCACHE_MGMT_URL: undefined,
    IRON_SESSION_SECRET: "x".repeat(48),
    IRON_SESSION_COOKIE_NAME: "hcm_session",
    NODE_ENV: "test",
  },
}));

// Stub out the real watcher so the test doesn't bind a poller.
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, watchFile: vi.fn(), unwatchFile: vi.fn() };
});

const { loadClusters } = await import("./loader");

const clusterA: Cluster = {
  id: "default",
  name: "Local",
  apiBaseUrl: "http://a:8080",
  mgmtBaseUrl: "http://a:8081",
};
const clusterB: Cluster = {
  id: "prod-eu",
  name: "Prod EU",
  apiBaseUrl: "http://b:8080",
  mgmtBaseUrl: "http://b:8081",
};

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  vi.mocked(loadClusters).mockReset();
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleInfoSpy.mockRestore();
});

describe("registry — initial load + atomic swap on reload", () => {
  it("loads the initial YAML at module evaluation time", async () => {
    vi.mocked(loadClusters).mockReturnValueOnce({ default: clusterA });
    vi.resetModules();
    const { getCluster, listClusters } = await import("./registry");
    expect(listClusters()).toHaveLength(1);
    expect(getCluster("default")?.apiBaseUrl).toBe("http://a:8080");
  });

  it("reload swaps the registry to the new state atomically", async () => {
    // Initial load returns 1 cluster.
    vi.mocked(loadClusters).mockReturnValueOnce({ default: clusterA });
    vi.resetModules();
    const mod = await import("./registry");
    expect(mod.listClusters()).toHaveLength(1);

    // Operator edits clusters.yaml — the next loadClusters call
    // returns 2 clusters.
    vi.mocked(loadClusters).mockReturnValueOnce({
      default: clusterA,
      "prod-eu": clusterB,
    });
    mod.__test_reloadFromPath("/tmp/test-clusters.yaml");

    expect(mod.listClusters()).toHaveLength(2);
    expect(mod.getCluster("prod-eu")?.apiBaseUrl).toBe("http://b:8080");
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining("reloaded 2 cluster(s)"),
    );
  });

  it("getter reads the latest reference after multiple reloads", async () => {
    vi.mocked(loadClusters).mockReturnValueOnce({
      a: { ...clusterA, id: "a" },
    });
    vi.resetModules();
    const mod = await import("./registry");
    expect(mod.getCluster("a")).toBeDefined();

    vi.mocked(loadClusters).mockReturnValueOnce({
      b: { ...clusterB, id: "b" },
    });
    mod.__test_reloadFromPath("/tmp/test-clusters.yaml");
    expect(mod.getCluster("a")).toBeUndefined();
    expect(mod.getCluster("b")).toBeDefined();

    vi.mocked(loadClusters).mockReturnValueOnce({
      c: { ...clusterA, id: "c" },
    });
    mod.__test_reloadFromPath("/tmp/test-clusters.yaml");
    expect(mod.getCluster("b")).toBeUndefined();
    expect(mod.getCluster("c")).toBeDefined();
  });
});

describe("registry — bad-input handling on reload", () => {
  it("keeps the previous registry when a reload throws ClusterLoaderError (bad YAML)", async () => {
    vi.mocked(loadClusters).mockReturnValueOnce({ default: clusterA });
    vi.resetModules();
    const mod = await import("./registry");
    const before = mod.listClusters();

    vi.mocked(loadClusters).mockImplementationOnce(() => {
      throw new ClusterLoaderError(
        "invalid clusters YAML at /tmp/test-clusters.yaml: bad indent",
      );
    });
    mod.__test_reloadFromPath("/tmp/test-clusters.yaml");

    expect(mod.listClusters()).toEqual(before);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[clusters] reload failed"),
    );
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it("keeps the previous registry when the file vanished (ENOENT)", async () => {
    vi.mocked(loadClusters).mockReturnValueOnce({ default: clusterA });
    vi.resetModules();
    const mod = await import("./registry");

    vi.mocked(loadClusters).mockImplementationOnce(() => {
      throw new ClusterLoaderError(
        "failed to read clusters file at /tmp/test-clusters.yaml: ENOENT: no such file or directory",
      );
    });
    mod.__test_reloadFromPath("/tmp/test-clusters.yaml");

    expect(mod.getCluster("default")).toBeDefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("ENOENT"),
    );
  });

  it("keeps the previous registry on schema-violation (e.g. duplicate hosts)", async () => {
    vi.mocked(loadClusters).mockReturnValueOnce({ default: clusterA });
    vi.resetModules();
    const mod = await import("./registry");

    vi.mocked(loadClusters).mockImplementationOnce(() => {
      throw new ClusterLoaderError(
        'invalid clusters YAML: host "x.example.com" is already claimed by cluster "prod-a"',
      );
    });
    mod.__test_reloadFromPath("/tmp/test-clusters.yaml");

    expect(mod.getCluster("default")).toBeDefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("already claimed"),
    );
  });

  it("keeps the previous registry on a non-ClusterLoaderError throw", async () => {
    // Unrelated error class — defensive: any throw from loadClusters
    // must keep the previous registry, not just the typed one.
    vi.mocked(loadClusters).mockReturnValueOnce({ default: clusterA });
    vi.resetModules();
    const mod = await import("./registry");

    vi.mocked(loadClusters).mockImplementationOnce(() => {
      throw new Error("unexpected fs glitch");
    });
    mod.__test_reloadFromPath("/tmp/test-clusters.yaml");

    expect(mod.getCluster("default")).toBeDefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("unexpected fs glitch"),
    );
  });
});
