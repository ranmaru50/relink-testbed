// src/security/httpClient.ts

import type { SecurityHttpClient, SecurityHttpRequest, SecurityHttpResponse } from "./types.js";

/** Node.js Fetch を管理認証受入れ runner へ注入可能な HTTP client に適合させる。 */
export class FetchSecurityHttpClient implements SecurityHttpClient {
  private readonly fetcher: typeof fetch;

  public constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
  }

  /** redirectを追従せず、Set-Cookieを含むraw応答を返す。 */
  public async request(request: SecurityHttpRequest): Promise<SecurityHttpResponse> {
    const response = await this.fetcher(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: request.redirect ?? "manual"
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => { headers[name.toLowerCase()] = value; });
    return { status: response.status, headers, body: await response.text() };
  }
}
