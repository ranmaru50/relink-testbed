// src/security/headerRunner.ts

import type { HeaderHttpClient, HeaderHttpResponse, HeaderSecurityProfile, HeaderSecurityReport, HeaderSecurityResult, HeaderSecurityResultClass, HeaderSecurityScenarioId, RawHeaderField } from "./headerTypes.js";

type Surface = "resolver-public" | "manifest" | "admin" | "trace" | "error";
type Transport = "https" | "http";
interface ScenarioOptions {
  readonly scenario: HeaderSecurityScenarioId;
  readonly transport: Transport;
  readonly path?: string;
  readonly url?: string;
  readonly surface: Surface;
  readonly expectedStatus?: number | readonly number[];
  readonly optional?: boolean;
}

/** Resolver の最終 wire response を Native / Container 別に検証する runner。 */
export class HeaderSecurityAcceptanceRunner {
  public constructor(private readonly profile: HeaderSecurityProfile, private readonly http: HeaderHttpClient) {}

  /** profile に対応した全シナリオを実行し、結果を profile 単位で返す。 */
  public async run(): Promise<HeaderSecurityReport> {
    const results: HeaderSecurityResult[] = [];
    if (this.profile.name === "native") {
      await this.execute(results, { scenario: "NATIVE-HTTPS-PUBLIC", transport: "https", path: this.profile.publicPath, surface: "resolver-public", expectedStatus: 303 });
      await this.execute(results, { scenario: "NATIVE-HTTPS-MANIFEST", transport: "https", path: this.profile.manifestPath, surface: "manifest", expectedStatus: 200 });
      await this.execute(results, { scenario: "NATIVE-HTTPS-ADMIN", transport: "https", path: this.profile.adminPath, surface: "admin", expectedStatus: 200 });
      await this.execute(results, { scenario: "NATIVE-HTTPS-APACHE-ERROR", transport: "https", path: this.profile.apacheErrorPath, surface: "error" });
      await this.execute(results, { scenario: "NATIVE-HTTPS-TRACE", transport: "https", path: this.profile.tracePath, surface: "trace", expectedStatus: 405 });
      await this.execute(results, { scenario: "NATIVE-HTTPS-REDIRECT", transport: "https", path: this.profile.publicPath, surface: "resolver-public", expectedStatus: 303 });
      await this.execute(results, { scenario: "NATIVE-HTTPS-4XX", transport: "https", path: this.profile.clientErrorPath, surface: "resolver-public", expectedStatus: 400 });
      await this.execute(results, { scenario: "NATIVE-HTTPS-5XX", transport: "https", url: this.profile.serverErrorUrl, surface: "resolver-public", expectedStatus: [500, 501, 502, 503, 504, 505], optional: true });
      await this.execute(results, { scenario: "NATIVE-HTTP-DEVELOPMENT", transport: "http", path: this.profile.publicPath, surface: "resolver-public" });
    } else {
      const transport = this.profile.httpsUrl === undefined ? "http" : "https";
      await this.execute(results, { scenario: "CONTAINER-PUBLIC-400", transport, path: this.profile.clientErrorPath, surface: "resolver-public", expectedStatus: 400 });
      await this.execute(results, { scenario: "CONTAINER-PUBLIC-503", transport, url: this.profile.serverErrorUrl, surface: "error", expectedStatus: 503 });
      await this.execute(results, { scenario: "CONTAINER-ADMIN-200", transport, path: this.profile.adminPath, surface: "admin", expectedStatus: 200 });
      await this.execute(results, { scenario: "CONTAINER-TRACE-405", transport, path: this.profile.tracePath, surface: "trace", expectedStatus: 405 });
      await this.execute(results, { scenario: "CONTAINER-SUCCESS-REDIRECT", transport, path: this.profile.publicPath, surface: "resolver-public", expectedStatus: [200, 303], optional: true });
    }
    return { reportVersion: "resolver-http-security-headers-0.1", profile: this.profile.name, generatedAt: new Date().toISOString(), results };
  }

  /** 未設定 endpoint や外部エラーを他シナリオへ波及させず正規化する。 */
  private async execute(results: HeaderSecurityResult[], options: ScenarioOptions): Promise<void> {
    const transport = options.url === undefined ? options.transport : this.transportForUrl(options.url);
    const baseUrl = transport === "https" ? this.profile.httpsUrl : this.profile.httpUrl;
    if (options.url === undefined && baseUrl === undefined) {
      results.push(this.result(options.scenario, "NOT-APPLICABLE", { transport, configured: false }, `${transport.toUpperCase()} endpoint is not configured.`));
      return;
    }
    if (options.url === undefined && options.path === undefined) {
      const result: HeaderSecurityResultClass = options.optional === true ? "UNSUPPORTED-OPTIONAL" : "NOT-APPLICABLE";
      results.push(this.result(options.scenario, result, { transport, configured: false }, "このシナリオを再現する endpoint が設定されていません。"));
      return;
    }
    const url = options.url ?? new URL(options.path ?? "/", baseUrl!).toString();
    try {
      const response = await this.http.request({ url, method: options.surface === "trace" ? "TRACE" : "GET" });
      const checks = this.checks(response, { ...options, transport });
      const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
      results.push(this.result(options.scenario, failures.length === 0 ? "PASS" : "FAIL", { ...this.snapshot(response), checks, transport, url }, failures.length === 0 ? undefined : `Failed checks: ${failures.join(", ")}`));
    } catch (error: unknown) {
      results.push(this.result(options.scenario, "FAIL", { transport, url }, error instanceof Error ? error.message : String(error)));
    }
  }

  /** 明示 URL の protocol を transport 判定へ反映する。 */
  private transportForUrl(url: string): Transport {
    const protocol = new URL(url).protocol;
    if (protocol === "https:") return "https";
    if (protocol === "http:") return "http";
    throw new Error(`Unsupported URL protocol: ${protocol}`);
  }

  /** 要件を scenario surface と transport に応じて boolean check へ変換する。 */
  private checks(response: HeaderHttpResponse, options: ScenarioOptions): Readonly<Record<string, boolean>> {
    const values = (name: string): readonly string[] => this.headerValues(response.rawHeaders, name);
    const statusExpected = options.expectedStatus === undefined ? (options.scenario.includes("ERROR") ? response.status >= 400 : true) : (Array.isArray(options.expectedStatus) ? options.expectedStatus.includes(response.status) : response.status === options.expectedStatus);
    const checks: Record<string, boolean> = {
      expectedStatus: statusExpected,
      xContentTypeOptions: values("x-content-type-options").length === 1 && values("x-content-type-options")[0]?.trim().toLowerCase() === "nosniff",
      noInformationDisclosure: values("server").every(value => ["apache", "relink", "relink-resolver"].includes(value.trim().toLowerCase())),
      noPoweredBy: values("x-powered-by").length === 0,
      hstsScope: options.transport === "https" ? values("strict-transport-security").length === 1 && values("strict-transport-security")[0]?.trim().toLowerCase() === "max-age=31536000" : values("strict-transport-security").length === 0
    };
    if (options.surface === "admin") {
      const csp = values("content-security-policy");
      checks.cacheControl = values("cache-control").length === 1 && values("cache-control")[0]?.trim().toLowerCase() === "no-store";
      checks.csp = csp.length === 1 && ["default-src 'none'", "form-action 'self'", "base-uri 'none'", "frame-ancestors 'none'"].every(directive => csp[0]?.toLowerCase().includes(directive) === true);
    }
    if (options.surface === "resolver-public") {
      checks.cors = values("access-control-allow-origin").length === 1 && values("access-control-allow-origin")[0]?.trim() === "*";
      checks.referrerPolicy = values("referrer-policy").length === 1 && values("referrer-policy")[0]?.trim().toLowerCase() === "no-referrer";
    }
    if (options.surface === "trace") checks.traceRejected = response.status === 405;
    return checks;
  }

  /** raw field の大小文字を無視して値を取得する。 */
  private headerValues(headers: readonly RawHeaderField[], name: string): readonly string[] {
    return headers.filter(header => header.name.toLowerCase() === name).map(header => header.value);
  }

  /** raw headers を含む JSON 化可能な観測値を作る。 */
  private snapshot(response: HeaderHttpResponse): Readonly<Record<string, unknown>> {
    return { status: response.status, headers: response.headers, rawHeaders: response.rawHeaders, body: response.body };
  }

  /** 結果の共通 envelope を生成する。 */
  private result(scenario: HeaderSecurityScenarioId, result: HeaderSecurityResultClass, observation: Readonly<Record<string, unknown>>, detail?: string): HeaderSecurityResult {
    return { profile: this.profile.name, scenario, result, observation, ...(detail === undefined ? {} : { detail }) };
  }
}
