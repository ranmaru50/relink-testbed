// src/security/rawHttpClient.ts

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { ClientRequest } from "node:http";
import type { HeaderHttpClient, HeaderHttpRequest, HeaderHttpResponse, RawHeaderField } from "./headerTypes.js";

/** raw HTTP client のリソース上限。 */
export interface RawSecurityHttpClientOptions {
  readonly timeoutMilliseconds?: number;
  readonly maxBodyBytes?: number;
}

/** Node.js の rawHeaders を保持して応答の field 重複を観測する HTTP client。 */
export class RawSecurityHttpClient implements HeaderHttpClient {
  private readonly timeoutMilliseconds: number;
  private readonly maxBodyBytes: number;

  public constructor(options: RawSecurityHttpClientOptions = {}) {
    this.timeoutMilliseconds = options.timeoutMilliseconds ?? 10_000;
    this.maxBodyBytes = options.maxBodyBytes ?? 1_048_576;
    if (!Number.isInteger(this.timeoutMilliseconds) || this.timeoutMilliseconds < 1) throw new Error("timeoutMilliseconds must be a positive integer.");
    if (!Number.isInteger(this.maxBodyBytes) || this.maxBodyBytes < 1) throw new Error("maxBodyBytes must be a positive integer.");
  }

  /** redirect を追従せず、status・全 header field・body を取得する。 */
  public request(request: HeaderHttpRequest): Promise<HeaderHttpResponse> {
    const url = new URL(request.url);
    const requester = url.protocol === "https:" ? httpsRequest : url.protocol === "http:" ? httpRequest : undefined;
    if (requester === undefined) return Promise.reject(new Error(`Unsupported URL protocol: ${url.protocol}`));
    return new Promise((resolve, reject) => {
      let settled = false;
      let clientRequest: ClientRequest;
      const finish = (operation: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        operation();
      };
      const timeout = setTimeout(() => {
        const error = new Error(`HTTP request timed out after ${this.timeoutMilliseconds} ms.`);
        finish(() => { clientRequest.destroy(error); reject(error); });
      }, this.timeoutMilliseconds);
      clientRequest = requester(url, { method: request.method ?? "GET", headers: request.headers }, response => {
        const rawHeaders = this.rawHeaders(response.rawHeaders);
        const headers = this.normalizedHeaders(rawHeaders);
        const chunks: Buffer[] = [];
        let bodyBytes = 0;
        response.on("data", chunk => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bodyBytes += buffer.byteLength;
          if (bodyBytes > this.maxBodyBytes) {
            response.destroy(new Error(`HTTP response body exceeded ${this.maxBodyBytes} bytes.`));
            finish(() => reject(new Error(`HTTP response body exceeded ${this.maxBodyBytes} bytes.`)));
            return;
          }
          chunks.push(buffer);
        });
        response.once("error", error => finish(() => reject(error)));
        response.once("end", () => finish(() => resolve({ status: response.statusCode ?? 0, headers, rawHeaders, body: Buffer.concat(chunks).toString("utf8") })));
      });
      clientRequest.once("error", error => finish(() => reject(error)));
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
