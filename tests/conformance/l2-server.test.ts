// tests/conformance/l2-server.test.ts
// L2-SRV catalog cases against the offline node:http stub Resolver: an explicit fixture
// registry, ephemeral port, clean close, and the §6 HTTP contract. The same handlers run
// against a Native/Container profile base URL through run.ts wiring.
// Test titles come from the coverage map so every title names its catalog case id.

import { describe, expect, it } from "vitest";
import { FetchHttpClient } from "../../src/conformance/httpClient.js";
import { runL2Case, defaultStubEntries } from "../../src/conformance/l2/runner.js";
import { FIXED_T } from "../../src/conformance/l2/scenarios.js";
import { startStubResolverServer } from "../../src/conformance/l2/stubResolverServer.js";
import type { CaseOutcome } from "../../src/conformance/l2/result.js";
import { L2_EXTRA_TITLES, L2_SRV_TITLES } from "./l2-coverage.js";

/** Start the stub, run one handler against it, and always close the server cleanly. */
async function runWithStub(caseId: string, options: { includeReferrerPolicy?: boolean } = {}): Promise<CaseOutcome> {
  const stub = await startStubResolverServer({
    entries: defaultStubEntries(),
    fixedT: FIXED_T,
    includeReferrerPolicy: options.includeReferrerPolicy ?? true
  });
  try {
    return await runL2Case(caseId, { client: new FetchHttpClient(), baseUrl: stub.baseUrl });
  } finally {
    await stub.close();
  }
}

describe("L2 server conformance (L2-SRV)", () => {
  for (const { caseId, title } of L2_SRV_TITLES) {
    it(`${caseId} — ${title}`, async () => {
      const outcome = await runWithStub(caseId);
      expect(outcome.result, `${caseId}: ${outcome.detail ?? ""}`).toBe("PASS");
    });
  }

  it(L2_EXTRA_TITLES[8]?.[1] ?? "L2-SRV-006 deviation", async () => {
    const outcome = await runWithStub("L2-SRV-006", { includeReferrerPolicy: false });
    expect(outcome.result).toBe("PASS-WITH-DEVIATION");
    expect(String(outcome.detail)).toContain("deviation");
  });
});
