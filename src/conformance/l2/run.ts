// src/conformance/l2/run.ts
// L2 conformance entrypoint: runs every L2 catalog case against a profile base URL (Native or
// Container when wired through the environment) or against the offline stub, and writes a
// ConformanceReport JSON artifact with the L2-* targets and catalog version 0.1-draft.

import { mkdir, writeFile } from "node:fs/promises";
import { FetchHttpClient } from "../httpClient.js";
import { L2_CONFORMANCE_CATALOG_VERSION, L2_CONFORMANCE_CASES } from "./catalog.js";
import { buildConformanceResult, type ReportContext } from "./result.js";
import { runL2Case, defaultStubEntries, type L2RunContext } from "./runner.js";
import { startStubResolverServer } from "./stubResolverServer.js";
import { FIXED_T } from "./scenarios.js";
import { PINNED_RESOLVER_COMMIT } from "../profiles.js";
import type { ConformanceReport, ConformanceResult } from "../types.js";

/** Run all L2 catalog cases; the offline stub is used when no base URL is wired. */
export async function runL2Suite(options: {
  profile: string;
  baseUrl?: string | undefined;
  resolverCommit?: string;
}): Promise<ConformanceReport> {
  const stub = options.baseUrl === undefined ? await startStubResolverServer({ entries: defaultStubEntries(), fixedT: FIXED_T }) : undefined;
  const context: L2RunContext = {
    client: new FetchHttpClient(),
    baseUrl: options.baseUrl ?? stub?.baseUrl ?? ""
  };
  const reportContext: ReportContext = {
    catalogVersion: L2_CONFORMANCE_CATALOG_VERSION,
    profile: options.profile,
    resolverCommit: options.resolverCommit ?? PINNED_RESOLVER_COMMIT
  };
  const results: ConformanceResult[] = [];
  for (const caseItem of L2_CONFORMANCE_CASES) {
    const outcome = await runL2Case(caseItem.id, context);
    const target = caseItem.targets[0];
    if (target === undefined) {
      throw new Error(`catalog case ${caseItem.id} has no target`);
    }
    results.push(buildConformanceResult(caseItem, target, reportContext, outcome));
  }
  if (stub !== undefined) {
    await stub.close();
  }
  return {
    catalogVersion: L2_CONFORMANCE_CATALOG_VERSION,
    profile: options.profile,
    resolverCommit: reportContext.resolverCommit,
    generatedAt: new Date().toISOString(),
    results
  };
}

/** CLI: writes the L2 report artifact for the profile wired in the environment. */
async function main(): Promise<void> {
  const nativeUrl = process.env.RELINK_NATIVE_URL;
  const containerUrl = process.env.RELINK_CONTAINER_URL;
  const profile = nativeUrl !== undefined ? "native" : containerUrl !== undefined ? "container" : "stub-offline";
  const baseUrl = nativeUrl ?? containerUrl;
  const report = await runL2Suite({ profile, baseUrl });
  const outputDirectory = process.env.RELINK_L2_OUTPUT_DIR ?? "reports/resolver-l2-0.1-draft";
  await mkdir(outputDirectory, { recursive: true });
  const path = `${outputDirectory}/${profile}.json`;
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const failed = report.results.filter(result => result.result === "FAIL").length;
  console.log(`${profile}: ${String(report.results.length)} cases, ${String(failed)} FAIL, ${path}`);
}

await main();
