// tests/conformance/l2-coverage.test.ts
// One vitest case asserting that every L2 catalog case id is covered by a named test, that no
// coverage entry refers to an unknown id, and that each suite's it() titles come from the same
// map (so a title always names its catalog case id).

import { describe, expect, it } from "vitest";
import { l2CatalogIds, findL2CatalogCase } from "../../src/conformance/l2/catalog.js";
import { L2_COVERAGE, L2_EXTRA_TITLES, L2_PRO_TITLES, L2_SRV_TITLES, L2_VER_TITLES, l2UncoveredIds, l2UnknownIds } from "./l2-coverage.js";

describe("L2 catalog coverage", () => {
  it("every one of the 91 L2 catalog case ids is covered by a test title naming it", () => {
    const catalogIds = l2CatalogIds();
    expect(catalogIds.length).toBe(91);
    expect(l2UncoveredIds()).toEqual([]);
    expect(Object.keys(L2_COVERAGE).length).toBe(91);
    for (const caseId of catalogIds) {
      expect(L2_COVERAGE[caseId]?.length ?? 0, `coverage for ${caseId}`).toBeGreaterThan(0);
    }
  });

  it("no coverage entry refers to an unknown catalog case id", () => {
    expect(l2UnknownIds()).toEqual([]);
    for (const caseId of Object.keys(L2_COVERAGE)) {
      expect(findL2CatalogCase(caseId), caseId).toBeDefined();
    }
  });

  it("suite titles are generated from the coverage map titles", () => {
    expect(L2_VER_TITLES.length).toBe(47);
    expect(L2_PRO_TITLES.length).toBe(12);
    expect(L2_SRV_TITLES.length).toBe(8);
    expect(L2_EXTRA_TITLES.length).toBe(9);
    for (const { caseId, title } of [...L2_VER_TITLES, ...L2_PRO_TITLES, ...L2_SRV_TITLES]) {
      expect(L2_COVERAGE[caseId], caseId).toContain(`${caseId} — ${title}`);
    }
    for (const [caseId, name] of L2_EXTRA_TITLES) {
      expect(L2_COVERAGE[caseId], caseId).toContain(name);
    }
  });
});
