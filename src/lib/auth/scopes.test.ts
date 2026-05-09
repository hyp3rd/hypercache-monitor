import { describe, expect, it } from "vitest";
import { describeScope, scopeCatalog } from "./scopes";

/**
 * Pins:
 *   - Every value in the `Scope` union has a catalog entry.
 *     Adding a new scope to the union without updating the
 *     catalog is a TS error today (`Record<Scope, ...>`), but
 *     a runtime check guards against the entry being added but
 *     left empty (`actions: []`) which would silently degrade
 *     the auth-info page.
 *   - `describeScope` returns the same instance the catalog
 *     stores; callers can compare references when needed.
 */

describe("scopeCatalog", () => {
  it("has a non-empty entry for every scope in the union", () => {
    const required = ["read", "write", "admin"] as const;
    for (const scope of required) {
      const entry = scopeCatalog[scope];
      expect(entry, `missing catalog entry for ${scope}`).toBeDefined();
      expect(entry.label.length, `empty label for ${scope}`).toBeGreaterThan(0);
      expect(
        entry.summary.length,
        `empty summary for ${scope}`,
      ).toBeGreaterThan(0);
      expect(
        entry.actions.length,
        `empty actions list for ${scope}`,
      ).toBeGreaterThan(0);
    }
  });

  it("describeScope returns the same instance as the catalog", () => {
    expect(describeScope("admin")).toBe(scopeCatalog.admin);
    expect(describeScope("read")).toBe(scopeCatalog.read);
    expect(describeScope("write")).toBe(scopeCatalog.write);
  });
});
