// src/index.ts
export { startTestbed } from "./testbed/Testbed.js";
export type { TestbedInstance } from "./testbed/TestbedInstance.js";
export type { RecordedRequest, RequestHistory, TestCase, TestCaseDefinition } from "./testbed/types.js";
export { FetchHttpClient } from "./conformance/httpClient.js";
export { ResolverConformanceRunner } from "./conformance/runner.js";
export { loadResolverProfiles, PINNED_RESOLVER_COMMIT } from "./conformance/profiles.js";
export type { ConformanceReport, ConformanceResult, ResolverProfile } from "./conformance/types.js";
export { HeaderSecurityAcceptanceRunner } from "./security/headerRunner.js";
export { loadHeaderSecurityProfiles } from "./security/headerProfiles.js";
export { RawSecurityHttpClient } from "./security/rawHttpClient.js";
export type { HeaderSecurityProfile, HeaderSecurityReport, HeaderSecurityResult } from "./security/headerTypes.js";
export type { RawSecurityHttpClientOptions } from "./security/rawHttpClient.js";

/** Starts the testbed for manual inspection and waits for a termination signal. */
if (process.argv[1]?.endsWith("index.ts")) {
  const testbed = await (await import("./testbed/Testbed.js")).startTestbed();
  console.log(`RELink Testbed\n\nEntity Origin:\n${testbed.entityOrigin}\n\nCross-Origin:\n${testbed.crossOrigin}\n\nDiagnostic API:\n${testbed.entityOrigin}/__testbed/info`);
  await new Promise<void>(resolve => process.once("SIGINT", resolve));
  await testbed.close();
}
