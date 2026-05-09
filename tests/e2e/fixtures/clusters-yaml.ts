import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  STUB_API_URL,
  STUB_API_URL_B,
  STUB_MGMT_URL,
  STUB_MGMT_URL_B,
} from "./cache-stub";

/**
 * Path of the temp `clusters.yaml` consumed by the Next.js
 * webServer via `HYPERCACHE_MONITOR_CLUSTERS`.
 *
 * The file is written **eagerly at module-load time** (the
 * side-effect on this module's import). This matters because
 * Playwright launches `webServer` and `globalSetup` concurrently:
 * webServer's first liveness probe hits the root page, which
 * triggers Next.js to evaluate `src/lib/clusters/registry.ts`,
 * which reads this YAML. If we waited for globalSetup to write
 * the file, that initial evaluation would race the write and
 * intermittently throw ENOENT.
 *
 * playwright.config.ts imports this module to bake the path into
 * `webServer.env`. That import resolves before webServer spawns,
 * so by the time the child process starts the file is on disk.
 *
 * The cluster URLs are computed from cache-stub.ts's fixed-port
 * constants, so writing the YAML doesn't depend on globalSetup
 * having started the stubs — the file is correct as long as the
 * stubs eventually bind those same ports, which globalSetup does
 * on a separate but converging timeline.
 *
 * Single deterministic location across runs is fine — the suite
 * is `workers: 1`, so there is no parallel-write contention.
 */
export const CLUSTERS_YAML_PATH = join(
  tmpdir(),
  "hypercache-monitor-e2e-clusters.yaml",
);

const yaml = `default:
  name: "Default cluster"
  apiBaseUrl: "${STUB_API_URL}"
  mgmtBaseUrl: "${STUB_MGMT_URL}"
secondary:
  name: "Secondary cluster"
  apiBaseUrl: "${STUB_API_URL_B}"
  mgmtBaseUrl: "${STUB_MGMT_URL_B}"
`;

writeFileSync(CLUSTERS_YAML_PATH, yaml, "utf-8");
