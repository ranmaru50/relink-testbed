// src/server/diagnostics/createDiagnosticsHandler.ts
import type { HttpHandler } from "../createHttpServer.js";
import type { TestCase, RecordedRequest, RequestHistory } from "../../testbed/types.js";

/** 診断 API が必要とする起動中 Testbed の依存関係。 */
export interface DiagnosticsContext {
  readonly entityOrigin: string;
  readonly crossOrigin: string;
  readonly cases: () => readonly TestCase[];
  readonly requests: RequestHistory;
}

/** Node.js 固有の値を含まない診断用リクエストへ変換する。 */
function serializeRequest(request: RecordedRequest): object {
  return { method: request.method, pathname: request.pathname, query: request.query, headers: request.headers, text: request.text, ...(request.json === undefined ? {} : { json: request.json }), endpointId: request.endpointId, timestamp: request.timestamp, bodyLength: request.body.byteLength };
}

/** Harness が参照する JSON 診断 API ハンドラーを作成する。 */
export function createDiagnosticsHandler(context: DiagnosticsContext): HttpHandler {
  return (request, response) => {
    const url = new URL(request.url ?? "/", context.entityOrigin);
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.method === "GET" && url.pathname === "/__testbed/info") { response.end(JSON.stringify({ name: "RELink Testbed", version: "0.1.0", entityOrigin: context.entityOrigin, crossOrigin: context.crossOrigin })); return; }
    if (request.method === "GET" && url.pathname === "/__testbed/cases") { response.end(JSON.stringify(context.cases())); return; }
    if (request.method === "GET" && url.pathname.startsWith("/__testbed/cases/")) {
      const id = decodeURIComponent(url.pathname.slice("/__testbed/cases/".length));
      const testCase = context.cases().find(item => item.id === id);
      if (testCase === undefined) { response.statusCode = 404; response.end(JSON.stringify({ error: { code: "case-not-found", message: "Unknown test case." } })); return; }
      response.end(JSON.stringify(testCase)); return;
    }
    if (request.method === "GET" && url.pathname === "/__testbed/requests") { response.end(JSON.stringify(context.requests.all().map(serializeRequest))); return; }
    if (request.method === "GET" && url.pathname.startsWith("/__testbed/requests/")) { response.end(JSON.stringify(context.requests.all(decodeURIComponent(url.pathname.slice("/__testbed/requests/".length))).map(serializeRequest))); return; }
    if (request.method === "POST" && url.pathname === "/__testbed/reset") { context.requests.reset(); response.statusCode = 204; response.end(); return; }
    response.statusCode = 404; response.end(JSON.stringify({ error: { code: "not-found", message: "Unknown diagnostic endpoint." } }));
  };
}
