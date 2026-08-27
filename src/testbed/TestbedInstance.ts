// src/testbed/TestbedInstance.ts
import { getCaseDefinition } from "../cases/registry.js";
import type { TestCase, TestCaseDefinition, RequestHistory } from "./types.js";

/** Started testbed API for use by external runtimes. */
export interface TestbedInstance {
  readonly entityOrigin: string;
  readonly crossOrigin: string;
  readonly requests: RequestHistory;
  case(id: string): TestCase;
  close(): Promise<void>;
}

/** Looks up a case and fails clearly for an unknown ID. */
export function requireCase(id: string): TestCaseDefinition {
  const testCase = getCaseDefinition(id);
  if (testCase === undefined) throw new Error(`Unknown test case: ${id}`);
  return testCase;
}
