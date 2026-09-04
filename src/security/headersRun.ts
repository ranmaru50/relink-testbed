// src/security/headersRun.ts

import { mkdir, writeFile } from "node:fs/promises";
import { loadHeaderSecurityProfiles } from "./headerProfiles.js";
import { HeaderSecurityAcceptanceRunner } from "./headerRunner.js";
import { RawSecurityHttpClient } from "./rawHttpClient.js";

/** Native / Container の HTTP security header 結果を profile 別 JSON として出力する CLI。 */
async function main(): Promise<void> {
  const outputDirectory = process.env.RELINK_SECURITY_HEADERS_OUTPUT_DIR ?? "reports/security-headers-0.1";
  await mkdir(outputDirectory, { recursive: true });
  for (const profile of loadHeaderSecurityProfiles()) {
    const report = await new HeaderSecurityAcceptanceRunner(profile, new RawSecurityHttpClient()).run();
    const path = `${outputDirectory}/${profile.name}.json`;
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const failed = report.results.filter(result => result.result === "FAIL").length;
    console.log(`${profile.name}: ${failed} FAIL, ${path}`);
  }
}

await main();
