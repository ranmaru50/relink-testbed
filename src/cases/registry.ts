// src/cases/registry.ts
import http204NoOutput from "../../cases/http/http-204-no-output.json" with { type: "json" };
import malformedJson from "../../cases/response/malformed-json.json" with { type: "json" };
import multiOutputJson from "../../cases/response/multi-output-json.json" with { type: "json" };
import singleOutputJson from "../../cases/response/single-output-json.json" with { type: "json" };
import http500 from "../../cases/http/http-500.json" with { type: "json" };
import postJson from "../../cases/request/post-json.json" with { type: "json" };
import relativeEndpointInvocable from "../../cases/url/relative-endpoint-invocable.json" with { type: "json" };
import type { TestCaseDefinition } from "./types.js";

/** JSON ケース定義の構造を実行時に検証する。 */
function validateCaseDefinition(value: unknown): TestCaseDefinition {
  if (typeof value !== "object" || value === null) throw new Error("Case definition must be an object.");
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.group !== "string" || typeof record.description !== "string") {
    throw new Error("Case definition requires string id, group, and description.");
  }
  return record as unknown as TestCaseDefinition;
}

/** JSON ファイルを唯一の正本とする、Harness 実行可能なケース定義。 */
export const caseDefinitions: readonly TestCaseDefinition[] = [
  singleOutputJson, multiOutputJson, postJson, http204NoOutput, relativeEndpointInvocable, http500, malformedJson
].map(validateCaseDefinition);

/** 安定 ID からケースを取得する。 */
export function getCaseDefinition(id: string): TestCaseDefinition | undefined {
  return caseDefinitions.find(testCase => testCase.id === id);
}
