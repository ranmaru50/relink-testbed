// src/index.ts
export { startTestbed } from "./testbed/Testbed.js";
export type { TestbedInstance } from "./testbed/TestbedInstance.js";
export type { RecordedRequest, RequestHistory, TestCase, TestCaseDefinition } from "./testbed/types.js";

/** Starts the testbed for manual inspection and waits for a termination signal. */
if (process.argv[1]?.endsWith("index.ts")) {
  const testbed = await (await import("./testbed/Testbed.js")).startTestbed();
  console.log(`RELink Testbed\n\nEntity Origin:\n${testbed.entityOrigin}\n\nCross-Origin:\n${testbed.crossOrigin}`);
  await new Promise<void>(resolve => process.once("SIGINT", resolve));
  await testbed.close();
}
