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
export function validateCaseDefinition(value: unknown): TestCaseDefinition {
  if (typeof value !== "object" || value === null) throw new Error("Case definition must be an object.");
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.group !== "string" || typeof record.description !== "string") {
    throw new Error("Case definition requires string id, group, and description.");
  }
  if (typeof record.document !== "string" || typeof record.capabilityId !== "string") {
    throw new Error(`Case ${record.id} requires string document and capabilityId.`);
  }
  if (!isRecord(record.inputs) || !isRecord(record.expected)) {
    throw new Error(`Case ${record.id} requires object inputs and expected.`);
  }
  return record as unknown as TestCaseDefinition;
}

/** ケース定義配列を検証し、ID の重複を拒否する。 */
export function createCaseDefinitions(values: readonly unknown[]): readonly TestCaseDefinition[] {
  const definitions = values.map(validateCaseDefinition);
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`Duplicate case ID: ${definition.id}`);
    ids.add(definition.id);
  }
  return definitions;
}

/** 値が JSON object かを判定する。 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON ファイルを唯一の正本とする、Harness 実行可能なケース定義。 */
export const caseDefinitions = createCaseDefinitions([
  singleOutputJson, multiOutputJson, postJson, http204NoOutput, relativeEndpointInvocable, http500, malformedJson
]);

/** 安定 ID からケースを取得する。 */
export function getCaseDefinition(id: string): TestCaseDefinition | undefined {
  return caseDefinitions.find(testCase => testCase.id === id);
}
