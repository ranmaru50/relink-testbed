// src/security/run.ts

import { mkdir, writeFile } from "node:fs/promises";
import { FetchSecurityHttpClient } from "./httpClient.js";
import { loadSecurityProfiles } from "./profiles.js";
import { AdminSecurityAcceptanceRunner } from "./runner.js";

/** Native / Container の管理認証受入れ結果を個別 JSON artifact として出力する CLI。 */
async function main(): Promise<void> {
  const outputDirectory = process.env.RELINK_SECURITY_OUTPUT_DIR ?? "reports/admin-security-0.1";
  await mkdir(outputDirectory, { recursive: true });
  for (const profile of loadSecurityProfiles()) {
    const report = await new AdminSecurityAcceptanceRunner(profile, new FetchSecurityHttpClient()).run();
    const path = `${outputDirectory}/${profile.name}.json`;
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const failed = report.results.filter(result => result.result === "FAIL").length;
    console.log(`${profile.name}: ${failed} FAIL, ${path}`);
  }
}

await main();
