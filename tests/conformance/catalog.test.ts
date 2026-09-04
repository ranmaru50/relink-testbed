// tests/conformance/catalog.test.ts

import { describe, expect, it } from "vitest";
import { CONFORMANCE_CATALOG_VERSION, conformanceCatalog, findCatalogCase } from "../../src/conformance/catalog.js";
import { loadResolverProfiles, PINNED_RESOLVER_COMMIT } from "../../src/conformance/profiles.js";

describe("Frozen Resolver / Manifest Catalog", () => {
  it("keeps stable case IDs and target-specific metadata", () => {
    expect(CONFORMANCE_CATALOG_VERSION).toBe("0.1");
    expect(new Set(conformanceCatalog.map(testCase => testCase.id)).size).toBe(conformanceCatalog.length);
    expect(findCatalogCase("RES-001")).toMatchObject({ targets: ["RESOLVER-SERVER"], strength: "MUST" });
    expect(findCatalogCase("LIFE-010")).toMatchObject({ targets: ["LIFECYCLE-ADMIN", "RESOLVER-SERVER"] });
    expect(findCatalogCase("MAN-001")).toMatchObject({ targets: ["MANIFEST-CONSUMER", "MANIFEST-PRODUCER"] });
    expect(findCatalogCase("INT-008")).toMatchObject({ targets: ["INTEGRITY-CONSUMER"], strength: "MUST" });
  });

  it("loads two profiles with the same pinned Resolver commit", () => {
    const profiles = loadResolverProfiles({
      RELINK_NATIVE_URL: "http://127.0.0.1:18081",
      RELINK_CONTAINER_URL: "http://127.0.0.1:18080",
      RELINK_ADMIN_PASSWORD: "test-password"
    });
    expect(profiles.map(profile => profile.name)).toEqual(["native", "container"]);
    expect(profiles.every(profile => profile.resolverCommit === PINNED_RESOLVER_COMMIT)).toBe(true);
  });
});
