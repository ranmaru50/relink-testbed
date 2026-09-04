// src/conformance/httpClient.ts

import type { ConformanceHttpClient, FetchHttpClientOptions, HttpRequest, HttpResponseSnapshot } from "./types.js";

/** Node.js の Fetch を適合性 runner へ注入可能な HTTP client に適合させる。 */
export class FetchHttpClient implements ConformanceHttpClient {
  private readonly fetcher: typeof fetch;

  public constructor(options: FetchHttpClientOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
  }

  public async request(request: HttpRequest): Promise<HttpResponseSnapshot> {
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
