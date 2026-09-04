// src/security/rawHttpClient.ts

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { HeaderHttpClient, HeaderHttpRequest, HeaderHttpResponse, RawHeaderField } from "./headerTypes.js";

/** Node.js の rawHeaders を保持して応答の field 重複を観測する HTTP client。 */
export class RawSecurityHttpClient implements HeaderHttpClient {
  /** redirect を追従せず、status・全 header field・body を取得する。 */
  public request(request: HeaderHttpRequest): Promise<HeaderHttpResponse> {
    const url = new URL(request.url);
    const requester = url.protocol === "https:" ? httpsRequest : url.protocol === "http:" ? httpRequest : undefined;
    if (requester === undefined) return Promise.reject(new Error(`Unsupported URL protocol: ${url.protocol}`));
    return new Promise((resolve, reject) => {
      const clientRequest = requester(url, { method: request.method ?? "GET", headers: request.headers }, response => {
        const rawHeaders = this.rawHeaders(response.rawHeaders);
        const headers = this.normalizedHeaders(rawHeaders);
        const chunks: Buffer[] = [];
        response.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.once("end", () => resolve({ status: response.statusCode ?? 0, headers, rawHeaders, body: Buffer.concat(chunks).toString("utf8") }));
      });
      clientRequest.once("error", reject);
      clientRequest.end();
    });
  }

  /** Node.js の name/value 配列を型付き raw field へ変換する。 */
  private rawHeaders(headers: readonly string[]): readonly RawHeaderField[] {
    const fields: RawHeaderField[] = [];
    for (let index = 0; index + 1 < headers.length; index += 2) fields.push({ name: headers[index] ?? "", value: headers[index + 1] ?? "" });
    return fields;
  }

  /** 既存の便利な header lookup 用に値をカンマ連結する。 */
  private normalizedHeaders(headers: readonly RawHeaderField[]): Readonly<Record<string, string>> {
    const normalized: Record<string, string> = {};
    for (const header of headers) normalized[header.name.toLowerCase()] = normalized[header.name.toLowerCase()] === undefined ? header.value : `${normalized[header.name.toLowerCase()]}, ${header.value}`;
    return normalized;
  }
}
