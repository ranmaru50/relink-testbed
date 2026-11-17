// tests/conformance/l2-producer.test.ts
// L2-PRO catalog cases: producer-side canonicalization, key derivation, pinned-vector
// reproduction, and the envelope/signature contract against the pinned fixtures.
// Test titles come from the coverage map so every title names its catalog case id.

import { describe, expect, it } from "vitest";
import { runL2Case } from "../../src/conformance/l2/runner.js";
import { L2_PRO_TITLES } from "./l2-coverage.js";

describe("L2 producer conformance (L2-PRO)", () => {
  for (const { caseId, title } of L2_PRO_TITLES) {
    it(`${caseId} — ${title}`, async () => {
      const outcome = await runL2Case(caseId, undefined);
      if (caseId === "L2-PRO-012") {
        expect(outcome.result, `${caseId}: ${outcome.detail ?? ""}`).toBe("UNSUPPORTED-OPTIONAL");
      } else {
        expect(outcome.result, `${caseId}: ${outcome.detail ?? ""}`).toBe("PASS");
      }
    });
  }
});
