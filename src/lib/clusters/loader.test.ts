import { describe, expect, it, vi } from "vitest";
import { ClusterLoaderError, DEFAULT_CLUSTER_ID, loadClusters } from "./loader";

/**
 * Unit tests for the multi-cluster loader. Use the `readFile`
 * + `warn` seams to keep tests hermetic — no real file system
 * touched, no console noise.
 */

describe("loadClusters — env-fallback path", () => {
  it("synthesizes a single-cluster registry from API/MGMT URLs when no YAML is set", () => {
    const out = loadClusters({
      clustersPath: undefined,
      apiUrl: "http://cache:8080",
      mgmtUrl: "http://cache:8081",
      readFile: () => {
        throw new Error("readFile must NOT be called on the env-fallback path");
      },
    });
    expect(Object.keys(out)).toEqual([DEFAULT_CLUSTER_ID]);
    expect(out[DEFAULT_CLUSTER_ID]).toEqual({
      id: DEFAULT_CLUSTER_ID,
      name: "Local cluster",
      apiBaseUrl: "http://cache:8080",
      mgmtBaseUrl: "http://cache:8081",
    });
  });

  it("throws ClusterLoaderError when neither YAML nor env vars are configured", () => {
    expect(() => loadClusters({ clustersPath: undefined, apiUrl: undefined, mgmtUrl: undefined })).toThrow(
      ClusterLoaderError,
    );
  });

  it("treats empty strings as 'unset' on the env-fallback path", () => {
    expect(() => loadClusters({ clustersPath: "", apiUrl: "", mgmtUrl: "" })).toThrow(ClusterLoaderError);
  });
});

describe("loadClusters — YAML path", () => {
  const validYaml = `
default:
  name: "Local cluster"
  apiBaseUrl: "http://cache:8080"
  mgmtBaseUrl: "http://cache:8081"
prod-eu:
  name: "Production EU"
  apiBaseUrl: "https://cache-eu.example.com:8080"
  mgmtBaseUrl: "https://cache-eu.example.com:8081"
`;

  it("parses a valid two-cluster YAML file", () => {
    const out = loadClusters({
      clustersPath: "/etc/monitor/clusters.yaml",
      apiUrl: undefined,
      mgmtUrl: undefined,
      readFile: () => validYaml,
    });
    expect(Object.keys(out).sort()).toEqual(["default", "prod-eu"]);
    expect(out["default"]).toEqual({
      id: "default",
      name: "Local cluster",
      apiBaseUrl: "http://cache:8080",
      mgmtBaseUrl: "http://cache:8081",
    });
    expect(out["prod-eu"]).toEqual({
      id: "prod-eu",
      name: "Production EU",
      apiBaseUrl: "https://cache-eu.example.com:8080",
      mgmtBaseUrl: "https://cache-eu.example.com:8081",
    });
  });

  it("logs a warning when both YAML and env vars are configured (YAML wins)", () => {
    const warn = vi.fn();
    const out = loadClusters({
      clustersPath: "/etc/monitor/clusters.yaml",
      apiUrl: "http://shadowed:8080",
      mgmtUrl: "http://shadowed:8081",
      readFile: () => validYaml,
      warn,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("HYPERCACHE_MONITOR_CLUSTERS");
    // Env-var URLs must NOT bleed into the parsed registry.
    expect(out["default"]?.apiBaseUrl).not.toBe("http://shadowed:8080");
  });

  it("throws ClusterLoaderError on a missing file (readFile throws)", () => {
    expect(() =>
      loadClusters({
        clustersPath: "/nonexistent.yaml",
        apiUrl: undefined,
        mgmtUrl: undefined,
        readFile: () => {
          throw new Error("ENOENT: no such file or directory");
        },
      }),
    ).toThrow(/failed to read clusters file/);
  });

  it("throws ClusterLoaderError on malformed YAML", () => {
    expect(() =>
      loadClusters({
        clustersPath: "/etc/monitor/clusters.yaml",
        apiUrl: undefined,
        mgmtUrl: undefined,
        // Tab-indented YAML (illegal — js-yaml rejects this strictly).
        readFile: () => "default:\n\tname: bad",
      }),
    ).toThrow(/failed to parse clusters YAML/);
  });

  it("rejects an empty cluster map (would silently boot with no clusters otherwise)", () => {
    expect(() =>
      loadClusters({
        clustersPath: "/etc/monitor/clusters.yaml",
        apiUrl: undefined,
        mgmtUrl: undefined,
        readFile: () => "{}",
      }),
    ).toThrow(/at least one cluster/);
  });

  it("rejects a cluster id with disallowed characters", () => {
    // Zod's record-key validation surfaces as a generic "Invalid
    // key in record" rather than our custom message; assert on
    // the wrapping ClusterLoaderError + a looser substring rather
    // than the exact phrasing zod emits.
    expect(() =>
      loadClusters({
        clustersPath: "/etc/monitor/clusters.yaml",
        apiUrl: undefined,
        mgmtUrl: undefined,
        // Slash makes the ID dangerous as a URL path segment.
        readFile: () => `bad/id:\n  name: x\n  apiBaseUrl: "http://x"\n  mgmtBaseUrl: "http://y"\n`,
      }),
    ).toThrow(ClusterLoaderError);
  });

  it("rejects a cluster entry missing apiBaseUrl", () => {
    expect(() =>
      loadClusters({
        clustersPath: "/etc/monitor/clusters.yaml",
        apiUrl: undefined,
        mgmtUrl: undefined,
        readFile: () => `default:\n  name: x\n  mgmtBaseUrl: "http://y"\n`,
      }),
    ).toThrow();
  });

  it("rejects a non-URL apiBaseUrl", () => {
    expect(() =>
      loadClusters({
        clustersPath: "/etc/monitor/clusters.yaml",
        apiUrl: undefined,
        mgmtUrl: undefined,
        readFile: () => `default:\n  name: x\n  apiBaseUrl: "not-a-url"\n  mgmtBaseUrl: "http://y"\n`,
      }),
    ).toThrow(/apiBaseUrl/);
  });

  it("returns a frozen registry (mutation throws in strict mode)", () => {
    const out = loadClusters({
      clustersPath: "/etc/monitor/clusters.yaml",
      apiUrl: undefined,
      mgmtUrl: undefined,
      readFile: () => validYaml,
    });
    expect(Object.isFrozen(out)).toBe(true);
  });
});

describe("loadClusters — Phase C2 hostname allowlist", () => {
  const yamlWithHosts = `
default:
  name: "Local cluster"
  apiBaseUrl: "http://cache:8080"
  mgmtBaseUrl: "http://cache:8081"
prod-eu:
  name: "Production EU"
  hosts: ["monitor-eu.example.com", "monitor-eu.internal"]
  apiBaseUrl: "https://cache-eu.example.com:8080"
  mgmtBaseUrl: "https://cache-eu.example.com:8081"
`;

  it("parses hosts as part of the cluster entry", () => {
    const out = loadClusters({
      clustersPath: "/etc/monitor/clusters.yaml",
      apiUrl: undefined,
      mgmtUrl: undefined,
      readFile: () => yamlWithHosts,
    });
    expect(out["prod-eu"]?.hosts).toEqual(["monitor-eu.example.com", "monitor-eu.internal"]);
    // Cluster without `hosts` keeps the field undefined (not [])
    // so login-page logic can distinguish "no allowlist" from
    // "explicitly empty allowlist" (which would never match).
    expect(out["default"]?.hosts).toBeUndefined();
  });

  it("rejects YAML where two clusters claim the same host", () => {
    const dupYaml = `
prod-eu:
  name: "Prod EU"
  hosts: ["monitor.example.com"]
  apiBaseUrl: "https://eu.example.com"
  mgmtBaseUrl: "https://eu.example.com:8081"
prod-us:
  name: "Prod US"
  hosts: ["monitor.example.com"]
  apiBaseUrl: "https://us.example.com"
  mgmtBaseUrl: "https://us.example.com:8081"
`;
    expect(() =>
      loadClusters({
        clustersPath: "/etc/monitor/clusters.yaml",
        apiUrl: undefined,
        mgmtUrl: undefined,
        readFile: () => dupYaml,
      }),
    ).toThrow(/already claimed/);
  });

  it("rejects a host with uppercase letters (case-insensitive matching is the contract; the YAML is the source of truth and must be normalized)", () => {
    const upperYaml = `
prod-eu:
  name: "Prod EU"
  hosts: ["Monitor-EU.example.com"]
  apiBaseUrl: "https://eu.example.com"
  mgmtBaseUrl: "https://eu.example.com:8081"
`;
    expect(() =>
      loadClusters({
        clustersPath: "/etc/monitor/clusters.yaml",
        apiUrl: undefined,
        mgmtUrl: undefined,
        readFile: () => upperYaml,
      }),
    ).toThrow(/bare lowercase hostname/);
  });

  it("rejects a host with a port suffix", () => {
    const portYaml = `
prod-eu:
  name: "Prod EU"
  hosts: ["monitor-eu.example.com:8443"]
  apiBaseUrl: "https://eu.example.com"
  mgmtBaseUrl: "https://eu.example.com:8081"
`;
    expect(() =>
      loadClusters({
        clustersPath: "/etc/monitor/clusters.yaml",
        apiUrl: undefined,
        mgmtUrl: undefined,
        readFile: () => portYaml,
      }),
    ).toThrow(/no scheme, no port/);
  });

  it("rejects a host with a scheme prefix", () => {
    const schemeYaml = `
prod-eu:
  name: "Prod EU"
  hosts: ["https://monitor-eu.example.com"]
  apiBaseUrl: "https://eu.example.com"
  mgmtBaseUrl: "https://eu.example.com:8081"
`;
    expect(() =>
      loadClusters({
        clustersPath: "/etc/monitor/clusters.yaml",
        apiUrl: undefined,
        mgmtUrl: undefined,
        readFile: () => schemeYaml,
      }),
    ).toThrow(/no scheme, no port/);
  });
});
