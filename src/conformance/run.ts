// src/conformance/run.ts

import { mkdir, writeFile } from "node:fs/promises";
import { FetchHttpClient } from "./httpClient.js";
import { loadResolverProfiles } from "./profiles.js";
import { ResolverConformanceRunner } from "./runner.js";

/** Native / Container の適合性結果を個別 JSON artifact として出力する CLI。 */
async function main(): Promise<void> {
  const outputDirectory = process.env.RELINK_CONFORMANCE_OUTPUT_DIR ?? "reports/resolver-conformance-0.1";
  const profiles = loadResolverProfiles();
  await mkdir(outputDirectory, { recursive: true });
  for (const profile of profiles) {
    const report = await new ResolverConformanceRunner(profile, new FetchHttpClient()).run();
    const path = `${outputDirectory}/${profile.name}.json`;
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`${profile.name}: ${report.results.filter(result => result.result === "FAIL").length} FAIL, ${path}`);
  }
}

await main();
