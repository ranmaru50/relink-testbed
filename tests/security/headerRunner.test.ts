// tests/security/headerRunner.test.ts

import { describe, expect, it } from "vitest";
import { HeaderSecurityAcceptanceRunner } from "../../src/security/headerRunner.js";
import type { HeaderHttpClient, HeaderHttpRequest, HeaderHttpResponse, HeaderSecurityProfile, RawHeaderField } from "../../src/security/headerTypes.js";

/** raw field の重複を保持した HTTP 応答を固定的に返す client。 */
class MockHeaderClient implements HeaderHttpClient {
  public readonly requests: HeaderHttpRequest[] = [];

  /** URL と request method に応じて Native / Container の代表応答を返す。 */
  public async request(request: HeaderHttpRequest): Promise<HeaderHttpResponse> {
    this.requests.push(request);
    const url = new URL(request.url);
    const https = url.protocol === "https:";
    const trace = request.method === "TRACE";
    const admin = url.pathname === "/admin.php";
    const manifest = url.pathname.endsWith("/manifest");
    const clientError = url.pathname === "/relink/not-a-uuid";
    const serverError = url.pathname === "/security/503";
    const apacheError = url.pathname === "/not-found";
    const status = trace ? 405 : admin ? 200 : serverError ? 503 : clientError ? 400 : apacheError ? 404 : manifest ? 200 : 303;
    const fields: RawHeaderField[] = [
      { name: "X-Content-Type-Options", value: "nosniff" },
      { name: "Server", value: "relink" }
    ];
    if (https) fields.push({ name: "Strict-Transport-Security", value: "max-age=31536000" });
    if (admin) fields.push({ name: "Cache-Control", value: "no-store" }, { name: "Content-Security-Policy", value: "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
    if (!admin && !manifest && !trace) fields.push({ name: "Access-Control-Allow-Origin", value: "*" }, { name: "Referrer-Policy", value: "no-referrer" });
    return { status, headers: this.toHeaders(fields), rawHeaders: fields, body: admin ? "login" : "" };
  }

  /** raw field を runner の lookup 用 map へ変換する。 */
  private toHeaders(fields: readonly RawHeaderField[]): Readonly<Record<string, string>> {
    const headers: Record<string, string> = {};
    for (const field of fields) headers[field.name.toLowerCase()] = field.value;
    return headers;
  }
}

function nativeProfile(): HeaderSecurityProfile {
  return {
    name: "native",
    httpsUrl: "https://native.test",
    httpUrl: "http://native.test",
    publicPath: "/relink/550e8400-e29b-41d4-a716-446655440000",
    manifestPath: "/relink/550e8400-e29b-41d4-a716-446655440000/manifest",
    adminPath: "/admin.php",
    apacheErrorPath: "/not-found",
    tracePath: "/relink/550e8400-e29b-41d4-a716-446655440000",
    clientErrorPath: "/relink/not-a-uuid",
    serverErrorUrl: "https://native.test/security/503"
  };
}

describe("HeaderSecurityAcceptanceRunner", () => {
  it("Native の HTTPS/HTTP 境界と raw header をシナリオ別に記録する", async () => {
    const client = new MockHeaderClient();
    const report = await new HeaderSecurityAcceptanceRunner(nativeProfile(), client).run();

    expect(report.reportVersion).toBe("resolver-http-security-headers-0.1");
    expect(report.results).toHaveLength(9);
    expect(report.results.every(result => result.result === "PASS")).toBe(true);
    expect(report.results.find(result => result.scenario === "NATIVE-HTTPS-PUBLIC")?.observation).toMatchObject({
      status: 303,
      rawHeaders: expect.arrayContaining([{ name: "X-Content-Type-Options", value: "nosniff" }]),
      checks: { hstsScope: true }
    });
    expect(report.results.find(result => result.scenario === "NATIVE-HTTP-DEVELOPMENT")?.observation).toMatchObject({ checks: { hstsScope: true } });
    expect(client.requests.some(request => request.method === "TRACE")).toBe(true);
  });

  it("X-Content-Type-Options の重複と情報露出を FAIL として区別する", async () => {
    const client: HeaderHttpClient = {
      request: async request => ({
        status: 303,
        headers: { "x-content-type-options": "nosniff, nosniff", server: "Apache/2.4.68", "x-powered-by": "PHP/8.3" },
        rawHeaders: [
          { name: "x-content-type-options", value: "nosniff" },
          { name: "X-Content-Type-Options", value: "nosniff" },
          { name: "Server", value: "Apache/2.4.68" },
          { name: "X-Powered-By", value: "PHP/8.3" },
          { name: "Access-Control-Allow-Origin", value: "*" },
          { name: "Referrer-Policy", value: "no-referrer" },
          { name: "Strict-Transport-Security", value: "max-age=31536000" }
        ],
        body: request.url
      })
    };
    const report = await new HeaderSecurityAcceptanceRunner(nativeProfile(), client).run();
    const result = report.results.find(item => item.scenario === "NATIVE-HTTPS-PUBLIC");
    expect(result?.result).toBe("FAIL");
    expect(result?.detail).toContain("xContentTypeOptions");
    expect(result?.detail).toContain("noInformationDisclosure");
    expect(result?.detail).toContain("noPoweredBy");
  });

  it("Server の内部 FQDN と private IP を情報露出として FAIL にする", async () => {
    const client: HeaderHttpClient = {
      request: async request => {
        const url = new URL(request.url);
        const manifest = url.pathname.endsWith("/manifest");
        const rawHeaders: RawHeaderField[] = [
          { name: "X-Content-Type-Options", value: "nosniff" },
          { name: "Server", value: manifest ? "10.0.0.5" : "internal-host.example" },
          { name: "Strict-Transport-Security", value: "max-age=31536000" }
        ];
        if (!manifest) rawHeaders.push({ name: "Access-Control-Allow-Origin", value: "*" }, { name: "Referrer-Policy", value: "no-referrer" });
        return { status: manifest ? 200 : 303, headers: {}, rawHeaders, body: "" };
      }
    };
    const report = await new HeaderSecurityAcceptanceRunner(nativeProfile(), client).run();
    expect(report.results.find(result => result.scenario === "NATIVE-HTTPS-PUBLIC")?.detail).toContain("noInformationDisclosure");
    expect(report.results.find(result => result.scenario === "NATIVE-HTTPS-MANIFEST")?.detail).toContain("noInformationDisclosure");
  });

  it("Server: Apache は許容し、version付き Apache は FAIL にする", async () => {
    const client: HeaderHttpClient = {
      request: async request => {
        const url = new URL(request.url);
        const manifest = url.pathname.endsWith("/manifest");
        const rawHeaders: RawHeaderField[] = [
          { name: "X-Content-Type-Options", value: "nosniff" },
          { name: "Server", value: manifest ? "Apache/2.4.68" : "Apache" },
          { name: "Strict-Transport-Security", value: "max-age=31536000" }
        ];
        if (!manifest) rawHeaders.push({ name: "Access-Control-Allow-Origin", value: "*" }, { name: "Referrer-Policy", value: "no-referrer" });
        return { status: manifest ? 200 : 303, headers: {}, rawHeaders, body: "" };
      }
    };
    const report = await new HeaderSecurityAcceptanceRunner(nativeProfile(), client).run();
    expect(report.results.find(result => result.scenario === "NATIVE-HTTPS-PUBLIC")).toMatchObject({ result: "PASS" });
    expect(report.results.find(result => result.scenario === "NATIVE-HTTPS-MANIFEST")?.detail).toContain("noInformationDisclosure");
  });

  it("Container の未設定 503 endpoint を UNSUPPORTED-OPTIONAL として記録する", async () => {
    const profile: HeaderSecurityProfile = { ...nativeProfile(), name: "container", httpsUrl: undefined, serverErrorUrl: undefined };
    const report = await new HeaderSecurityAcceptanceRunner(profile, new MockHeaderClient()).run();
    expect(report.results.find(result => result.scenario === "CONTAINER-PUBLIC-503")).toMatchObject({ result: "NOT-APPLICABLE" });
    expect(report.results.find(result => result.scenario === "CONTAINER-SUCCESS-REDIRECT")).toMatchObject({ result: "PASS" });
  });
});
