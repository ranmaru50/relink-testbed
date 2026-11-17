// tests/conformance/l2-verifier.test.ts
// L2-VER catalog cases: one test per catalog case id, each asserting the runner handler's
// result class against the pinned fixture scenarios (§15.2 phases 1-11, §9.6/§9.7 rules).
// Test titles come from the coverage map so every title names its catalog case id.

import { describe, expect, it } from "vitest";
import { runL2Case } from "../../src/conformance/l2/runner.js";
import { L2_VER_TITLES } from "./l2-coverage.js";

describe("L2 verifier conformance (L2-VER)", () => {
  for (const { caseId, title } of L2_VER_TITLES) {
    it(`${caseId} — ${title}`, async () => {
      const outcome = await runL2Case(caseId, undefined);
      if (caseId === "L2-VER-045") {
        expect(outcome.result, `${caseId}: ${outcome.detail ?? ""}`).toBe("UNSUPPORTED-OPTIONAL");
      } else {
        expect(outcome.result, `${caseId}: ${outcome.detail ?? ""}`).toBe("PASS");
      }
    });
  }
});
