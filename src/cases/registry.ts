// src/cases/registry.ts
import type { TestCaseDefinition } from "./types.js";

/** Stable JSON-compatible interoperability case definitions. */
export const caseDefinitions: readonly TestCaseDefinition[] = [
  { id: "doc-001-valid-document", group: "document", description: "有効な文書を取得する。", documentPath: "/arxml/valid/single-output-json.arxml" },
  { id: "doc-002-malformed-xml", group: "document", description: "不正 XML 文書を取得する。", documentPath: "/arxml/invalid/malformed-xml.arxml" },
  { id: "doc-003-http-404-document", group: "document", description: "存在しない文書は 404 となる。", documentPath: "/arxml/missing.arxml" },
  { id: "doc-004-delayed-document", group: "document", description: "遅延文書を取得する。", documentPath: "/arxml/edge/delay.arxml" },
  { id: "missing-capability-id", group: "validation", description: "Capability ID がない文書。", documentPath: "/arxml/invalid/missing-capability-id.arxml" },
  { id: "missing-capability-type", group: "validation", description: "Capability type がない文書。", documentPath: "/arxml/invalid/missing-capability-type.arxml" },
  { id: "duplicate-capability-id", group: "validation", description: "Capability ID が重複した文書。", documentPath: "/arxml/invalid/duplicate-capability-id.arxml" },
  { id: "duplicate-output-name", group: "validation", description: "出力名が重複した文書。", documentPath: "/arxml/invalid/duplicate-output-name.arxml" },
  { id: "invalid-namespace", group: "validation", description: "無効な名前空間の文書。", documentPath: "/arxml/invalid/invalid-namespace.arxml" },
  { id: "relative-endpoint-root", group: "url", description: "ルート相対 endpoint。", documentPath: "/arxml/edge/root-relative-endpoint.arxml" },
  { id: "relative-endpoint-path", group: "url", description: "パス相対 endpoint。", documentPath: "/arxml/edge/relative-endpoint.arxml" },
  { id: "relative-endpoint-parent", group: "url", description: "親相対 endpoint。", documentPath: "/arxml/edge/parent-relative-endpoint.arxml" },
  { id: "get-string", group: "request", description: "GET 文字列クエリを記録する。" },
  { id: "get-number", group: "request", description: "GET 数値クエリを記録する。" },
  { id: "get-integer", group: "request", description: "GET 整数クエリを記録する。" },
  { id: "get-boolean", group: "request", description: "GET 真偽値クエリを記録する。" },
  { id: "get-multiple-parameters", group: "request", description: "複数 GET クエリを記録する。" },
  { id: "get-url-encoding", group: "request", description: "URL エンコードされた GET クエリを記録する。" },
  { id: "single-output-json", group: "response", description: "単一 JSON 出力を返す。", documentPath: "/arxml/valid/single-output-json.arxml", expected: { invocation: { status: "success", representation: "application/json", values: { temperature: 20.1 } } } },
  { id: "multi-output-json", group: "response", description: "複数 JSON 出力を返す。", documentPath: "/arxml/valid/multi-output-json.arxml" },
  { id: "post-json", group: "request", description: "POST JSON 入力をエコーする。", documentPath: "/arxml/valid/post-json.arxml" },
  { id: "http-200", group: "http", description: "HTTP 200。" },
  { id: "http-201", group: "http", description: "HTTP 201。" },
  { id: "http-204-no-output", group: "http", description: "HTTP 204。", documentPath: "/arxml/valid/no-output-204.arxml" },
  { id: "http-400", group: "http", description: "HTTP 400。" },
  { id: "http-401", group: "http", description: "HTTP 401。" },
  { id: "http-403", group: "http", description: "HTTP 403。" },
  { id: "http-404", group: "http", description: "HTTP 404。" },
  { id: "http-500", group: "http", description: "HTTP 500。" },
  { id: "text-output", group: "response", description: "テキストを返す。", documentPath: "/arxml/valid/text-output.arxml" },
  { id: "binary-output", group: "response", description: "バイナリを返す。", documentPath: "/arxml/valid/binary-output.arxml" },
  { id: "malformed-json", group: "response", description: "不正な JSON 本文を返す。" },
  { id: "wrong-content-type", group: "response", description: "宣言と異なる Content-Type を返す。" },
  { id: "no-content-type", group: "response", description: "Content-Type なしで返す。" },
  { id: "missing-output", group: "response", description: "宣言済み JSON 出力がない。" },
  { id: "abort-delayed-response", group: "runtime", description: "中断可能な遅延応答を返す。" },
  { id: "cross-origin-allowed", group: "security", description: "CORS を許可する別 Origin。" },
  { id: "cross-origin-denied", group: "security", description: "CORS を許可しない別 Origin。" }
  , { id: "same-origin", group: "security", description: "同一 Origin の Capability。" }
  , { id: "preflight-success", group: "security", description: "CORS プリフライトを許可する。" }
  , { id: "preflight-rejection", group: "security", description: "CORS プリフライトを拒否する。" }
];

/** Gets a case by its stable ID. */
export function getCaseDefinition(id: string): TestCaseDefinition | undefined {
  return caseDefinitions.find(testCase => testCase.id === id);
}
