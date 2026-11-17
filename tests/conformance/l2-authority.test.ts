// tests/conformance/l2-authority.test.ts
// L2-AUT catalog cases: authority material rules — Record chain acceptance (§9.6), key
// mutation rules (§9.5), transfer trail matching (§12.2), floor semantics (§12.3), and the
// trust anchor binding for Record 0, all offline against the pinned fixtures.
// Test titles come from the coverage map so every title names its catalog case id.

import { describe, expect, it } from "vitest";
import { runL2Case } from "../../src/conformance/l2/runner.js";
import { L2_AUT_TITLES } from "./l2-coverage.js";

describe("L2 authority conformance (L2-AUT)", () => {
  for (const { caseId, title } of L2_AUT_TITLES) {
    it(`${caseId} — ${title}`, async () => {
      const outcome = await runL2Case(caseId, undefined);
      expect(outcome.result, `${caseId}: ${outcome.detail ?? ""}`).toBe("PASS");
    });
  }
});
