// src/server/capability/createCapabilityHandler.ts
import type { IncomingMessage } from "node:http";
import type { HttpHandler } from "../createHttpServer.js";
import type { RecordedRequest, RequestHistory } from "../../testbed/types.js";

/** Harness の基準ケースでブラウザーアクセスを許可する endpoint。 */
const HARNESS_CORS_ENDPOINTS = new Set([
  "/api/json/single", "/api/json/multi", "/api/json/echo", "/api/no-content",
  "/api/status/500", "/api/representation/malformed-json"
]);

/** インスタンスに閉じた受信リクエスト履歴を作成する。 */
export function createRequestHistory(): { readonly history: RequestHistory; record(request: RecordedRequest): void } {
  const records: RecordedRequest[] = [];
  return {
    history: { all: id => id === undefined ? [...records] : records.filter(record => record.endpointId === id), last: id => (id === undefined ? records : records.filter(record => record.endpointId === id)).at(-1), reset: () => { records.splice(0); } },
    record: request => { records.push(request); }
  };
}

/** リクエスト本文を安全にバイト列として取得する。 */
async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Capability 応答と受動的なリクエスト記録を提供するハンドラーを作成する。 */
export function createCapabilityHandler(record: (request: RecordedRequest) => void): HttpHandler {
  return async (request, response) => {
    const url = new URL(request.url ?? "/", "http://testbed.invalid");
    const body = await readBody(request);
    const text = body.toString("utf8");
    let json: unknown;
    try { json = text === "" ? undefined : JSON.parse(text) as unknown; } catch { json = undefined; }
    const query: Record<string, string[]> = {};
    url.searchParams.forEach((value, key) => { (query[key] ??= []).push(value); });
    const endpointId = url.pathname.replace(/^\/api\//, "").replaceAll("/", "-") || "unknown";
    record({ method: request.method ?? "GET", pathname: url.pathname, query, headers: request.headers, body, text, timestamp: Date.now(), endpointId, ...(json === undefined ? {} : { json }) });
    const send = (status: number, contentType: string | undefined, value?: string | Uint8Array) => {
      response.statusCode = status;
      if (HARNESS_CORS_ENDPOINTS.has(url.pathname)) response.setHeader("access-control-allow-origin", "*");
      if (contentType !== undefined) response.setHeader("content-type", contentType);
      response.end(value);
    };
    if (url.pathname === "/api/json/single") return send(200, "application/json", "20.1");
    if (url.pathname === "/api/json/multi") return send(200, "application/json", JSON.stringify({ temperature: 20.1, humidity: 44 }));
    if (url.pathname === "/api/text") return send(200, "text/plain; charset=utf-8", "hello");
    if (url.pathname === "/api/binary") return send(200, "application/octet-stream", Uint8Array.from([0, 1, 2, 255]));
    if (url.pathname === "/api/json/echo" && request.method === "POST") return send(200, "application/json", text || "null");
    if (url.pathname === "/api/no-content") return send(204, undefined);
    if (url.pathname === "/api/representation/malformed-json") return send(200, "application/json", "{\"temperature\":");
    if (url.pathname === "/api/representation/wrong-content-type") return send(200, "text/plain", "20.1");
    if (url.pathname === "/api/representation/no-content-type") return send(200, undefined, "20.1");
    if (url.pathname === "/api/representation/missing-output") return send(200, "application/json", "{}");
    if (url.pathname === "/api/network/delay") { setTimeout(() => send(200, "application/json", "20.1"), 1_000); return; }
    if (url.pathname === "/api/network/close") { request.socket.destroy(); return; }
    if (url.pathname === "/api/network/redirect") { response.writeHead(302, { location: "/api/json/single" }).end(); return; }
    const status = /^\/api\/status\/(200|201|400|401|403|404|500)$/.exec(url.pathname)?.[1];
    if (status !== undefined) return send(Number(status), "application/json", status === "201" ? "{}" : undefined);
    send(404, "application/json", "{}");
  };
}
