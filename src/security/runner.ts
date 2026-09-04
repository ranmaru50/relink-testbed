// src/security/runner.ts

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { findSecurityCase, securityCases } from "./catalog.js";
import type {
  ObservedCookie,
  SecurityCaseId,
  SecurityHttpClient,
  SecurityHttpRequest,
  SecurityHttpResponse,
  SecurityProfile,
  SecurityReport,
  SecurityResult,
  SecurityResultClass
} from "./types.js";

interface LoginOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly baseUrl?: string;
  readonly initialSessionId?: string;
  readonly username?: string;
  readonly password?: string;
}

interface LoginResult {
  readonly authenticated: boolean;
  readonly status: number;
  readonly preAuthenticationSessionId?: string;
  readonly postAuthenticationSessionId?: string;
  readonly csrf?: string;
  readonly cookie?: ObservedCookie;
  readonly body: string;
}

interface Waiter {
  wait(milliseconds: number): Promise<void>;
}

/** Set-Cookie を保持し、管理面の各リクエストへ Cookie を返す最小 jar。 */
class CookieJar {
  private readonly cookies = new Map<string, ObservedCookie>();

  /** Set-Cookie の属性を記録し、同名 Cookie を最新値へ置き換える。 */
  public save(headers: Readonly<Record<string, string>>): void {
    const setCookie = headers["set-cookie"];
    if (setCookie === undefined) return;
    for (const raw of setCookie.split(/,(?=[^;,]+=)/)) {
      const parts = raw.split(";").map(part => part.trim());
      const pair = parts.shift() ?? "";
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const attributes = new Set(parts.map(part => part.toLowerCase()));
      const name = pair.slice(0, separator).trim();
      this.cookies.set(name, { name, value: pair.slice(separator + 1), attributes, raw });
    }
  }

  /** セッション fixation 検証用の任意 Cookie を初期値として設定する。 */
  public seedSession(sessionId: string): void {
    this.cookies.set("PHPSESSID", { name: "PHPSESSID", value: sessionId, attributes: new Set(), raw: `PHPSESSID=${sessionId}` });
  }

  /** Cookie ヘッダーを構築する。 */
  public header(): string {
    return [...this.cookies.values()].map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
  }

  /** 指定した Cookie の最後の観測値を返す。 */
  public get(name: string): ObservedCookie | undefined {
    return this.cookies.get(name);
  }
}

/** Resolver 管理面のログイン、CSRF、mutation を外部 HTTP だけで操作する client。 */
class AdminSecurityClient {
  private readonly cookies = new CookieJar();

  public constructor(private readonly http: SecurityHttpClient, private readonly profile: SecurityProfile, private readonly baseUrl = profile.baseUrl, private readonly headers: Readonly<Record<string, string>> = {}) {}

  /** ログイン画面取得から認証後画面の CSRF 抽出までを実行する。 */
  public async login(options: LoginOptions = {}): Promise<LoginResult> {
    if (options.initialSessionId !== undefined) this.cookies.seedSession(options.initialSessionId);
    const requestHeaders = { ...this.headers, ...options.headers };
    await this.request({ url: this.adminUrl(options.baseUrl), method: "GET", headers: requestHeaders });
    const preAuthenticationSessionId = this.cookies.get("PHPSESSID")?.value;
    const body = new URLSearchParams({
      action: "login",
      username: options.username ?? this.profile.adminUsername,
      password: options.password ?? this.profile.adminPassword
    }).toString();
    let response = await this.request({
      url: this.adminUrl(options.baseUrl),
      method: "POST",
      headers: { ...requestHeaders, ...this.cookieHeader(), "content-type": "application/x-www-form-urlencoded" },
      body
    });
    if (response.status >= 300 && response.status < 400 && response.headers.location !== undefined) {
      response = await this.request({
        url: new URL(response.headers.location, this.adminUrl(options.baseUrl)).toString(),
        method: "GET",
        headers: { ...requestHeaders, ...this.cookieHeader() }
      });
    }
    const csrf = extractCsrf(response.body);
    return {
      authenticated: csrf !== "" && !response.body.includes('name="action" value="login"'),
      status: response.status,
      preAuthenticationSessionId,
      postAuthenticationSessionId: this.cookies.get("PHPSESSID")?.value,
      ...(csrf === "" ? {} : { csrf }),
      cookie: this.cookies.get("PHPSESSID"),
      body: response.body
    };
  }

  /** 認証済みセッションで管理画面を取得する。 */
  public async page(): Promise<SecurityHttpResponse> {
    return this.request({ url: this.adminUrl(), method: "GET", headers: { ...this.headers, ...this.cookieHeader() } });
  }

  /** CSRF token 付きまたは欠落した管理 mutation を送信する。 */
  public async mutation(fields: Readonly<Record<string, string>>, query = ""): Promise<SecurityHttpResponse> {
    const url = new URL(this.adminUrl());
    url.search = query;
    return this.request({
      url: url.toString(),
      method: "POST",
      headers: { ...this.headers, ...this.cookieHeader(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString()
    });
  }

  /** 認証済み管理 JSON API から UUID の存在を確認する。 */
  public async record(uuid: string): Promise<SecurityHttpResponse> {
    const url = new URL(this.adminUrl());
    url.searchParams.set("format", "json");
    url.searchParams.set("uuid", uuid);
    return this.request({ url: url.toString(), method: "GET", headers: { ...this.headers, ...this.cookieHeader() } });
  }

  /** 初期ログイン Cookie とログイン後 Cookie を含む Cookie jar を返す。 */
  public cookie(): ObservedCookie | undefined {
    return this.cookies.get("PHPSESSID");
  }

  private async request(request: SecurityHttpRequest): Promise<SecurityHttpResponse> {
    const response = await this.http.request(request);
    this.cookies.save(response.headers);
    return response;
  }

  private cookieHeader(): Readonly<Record<string, string>> {
    const cookie = this.cookies.header();
    return cookie === "" ? {} : { cookie };
  }

  private adminUrl(baseUrl = this.baseUrl): string {
    return new URL(this.profile.adminUrl ?? "/admin.php", baseUrl).toString();
  }
}

/** 管理認証受入れの外部観測可能なケースを Native / Container 別に実行する。 */
export class AdminSecurityAcceptanceRunner {
  private readonly waiter: Waiter;

  public constructor(private readonly profile: SecurityProfile, private readonly http: SecurityHttpClient, waiter: Waiter = { wait: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
    this.waiter = waiter;
  }

  /** ケースを順番に実行し、profile単位の結果を返す。 */
  public async run(): Promise<SecurityReport> {
    const results: SecurityResult[] = [];
    await this.execute(results, "AUTH-001", () => this.loginThrottleCase());
    await this.execute(results, "AUTH-002", () => this.ipSeparationCase());
    await this.execute(results, "SESSION-001", () => this.sessionEstablishmentCase());
    await this.execute(results, "SESSION-002", () => this.sessionTimeoutCase());
    await this.execute(results, "COOKIE-001", () => this.cookiePolicyCase());
    await this.execute(results, "PROXY-001", () => this.proxyHeaderCase());
    await this.execute(results, "SQLITE-001", () => this.sqliteEvidenceCase());
    return { reportVersion: "admin-security-0.1", profile: this.profile.name, generatedAt: new Date().toISOString(), results };
  }

  /** ケース失敗を他ケースへ波及させず、受入れ結果へ正規化する。 */
  private async execute(results: SecurityResult[], caseId: SecurityCaseId, operation: () => Promise<CaseOutcome>): Promise<void> {
    const definition = findSecurityCase(caseId);
    try {
      const outcome = await operation();
      results.push({ profile: this.profile.name, caseId, result: outcome.result ?? "PASS", observation: outcome.observation, ...(outcome.detail === undefined ? {} : { detail: outcome.detail }) });
    } catch (error: unknown) {
      results.push({ profile: this.profile.name, caseId, result: "FAIL", observation: {}, detail: error instanceof Error ? error.message : `${definition.description}: ${String(error)}` });
    }
  }

  /** 同一IPの失敗累積、username変更後のlock、lockout期限後の回復を検証する。 */
  private async loginThrottleCase(): Promise<CaseOutcome> {
    const headers = this.ipHeaders("192.0.2.1");
    const first = await this.client().login({ headers, username: "admin", password: "wrong" });
    const second = await this.client().login({ headers, username: "other-user", password: "wrong" });
    const locked = await this.client().login({ headers, username: this.profile.adminUsername, password: this.profile.adminPassword });
    this.require(!first.authenticated && !second.authenticated && !locked.authenticated, "同一IPの失敗累積またはusername変更後のlockが確認できません。");
    await this.waitFor(this.profile.loginLockoutSeconds);
    const recovered = await this.client().login({ headers });
    this.require(recovered.authenticated, "lockout期限後に正規ログインが回復しません。");
    return { observation: { firstStatus: first.status, secondStatus: second.status, lockedStatus: locked.status, recoveredStatus: recovered.status, usernameChanged: true, sameIp: true } };
  }

  /** IP bucket が別IPへ波及しないことを検証し、分散試行自体は対象外と明記する。 */
  private async ipSeparationCase(): Promise<CaseOutcome> {
    const blockedIp = await this.client().login({ headers: this.ipHeaders("192.0.2.2"), username: "admin", password: "wrong" });
    const validOtherIp = await this.client().login({ headers: this.ipHeaders("192.0.2.3") });
    this.require(!blockedIp.authenticated && validOtherIp.authenticated, "別IPの正規ログインが同一IPの失敗制限に巻き込まれました。");
    return { observation: { blockedIpStatus: blockedIp.status, otherIpStatus: validOtherIp.status, distributedIpAttempts: "out-of-scope" }, detail: "IPを変更する分散試行は管理ネットワーク制限の対象であり、このcaseでは評価しません。" };
  }

  /** 正常ログイン時の session ID rotation、CSRF token、strict mode の fixation 耐性を検証する。 */
  private async sessionEstablishmentCase(): Promise<CaseOutcome> {
    const client = this.client();
    const login = await client.login({ initialSessionId: "attacker-fixed-session-id" });
    this.require(login.authenticated && login.csrf !== undefined, "正常ログインまたはCSRF token発行を確認できません。");
    this.require(login.preAuthenticationSessionId !== login.postAuthenticationSessionId, "認証後にsession IDがrotationされません。");
    this.require(login.postAuthenticationSessionId !== "attacker-fixed-session-id", "攻撃者が指定したsession IDを認証後も受け入れています。");
    return { observation: { status: login.status, sessionIdRotated: true, csrfIssued: true, attackerSessionIdRejected: true } };
  }

  /** idle / absolute timeout 後の画面と form/API mutation の拒否を検証する。 */
  private async sessionTimeoutCase(): Promise<CaseOutcome> {
    const idleClient = this.client();
    const idleLogin = await idleClient.login();
    this.require(idleLogin.authenticated && idleLogin.csrf !== undefined, "idle timeout 検証用ログインに失敗しました。");
    await this.waitFor(this.profile.sessionIdleSeconds);
    const idlePage = await idleClient.page();
    const idleFixture = this.registrationFields(idleLogin.csrf ?? "", "idle");
    const idleMutation = await idleClient.mutation(idleFixture.fields);
    this.require(this.isLoginPage(idlePage.body) && this.isLoginPage(idleMutation.body), "idle timeout後も管理画面またはmutationが受理されました。");
    await this.requireRecordAbsent(idleFixture.uuid);

    const absoluteClient = this.client();
    const absoluteLogin = await absoluteClient.login();
    this.require(absoluteLogin.authenticated && absoluteLogin.csrf !== undefined, "absolute timeout 検証用ログインに失敗しました。");
    await this.waitFor(this.profile.sessionAbsoluteSeconds);
    const absolutePage = await absoluteClient.page();
    const absoluteFixture = this.registrationFields(absoluteLogin.csrf ?? "", "absolute");
    const absoluteMutation = await absoluteClient.mutation(absoluteFixture.fields, "format=json");
    this.require(this.isLoginPage(absolutePage.body) && this.isLoginPage(absoluteMutation.body), "absolute timeout後も管理画面またはAPI mutationが受理されました。");
    await this.requireRecordAbsent(absoluteFixture.uuid);
    return { observation: { idlePageRejected: true, idleMutationRejected: true, absolutePageRejected: true, absoluteApiMutationRejected: true } };
  }

  /** 管理 session Cookie の Secure / HttpOnly / SameSite=Strict を検証する。 */
  private async cookiePolicyCase(): Promise<CaseOutcome> {
    const login = await this.client(this.profile.trustedProxyHeaders).login();
    const cookie = login.cookie;
    this.require(login.authenticated && cookie !== undefined, "Cookie policy 検証用ログインに失敗しました。");
    const attributes = [...cookie.attributes];
    this.require(cookie.attributes.has("secure"), "管理session CookieにSecure属性がありません。");
    this.require(cookie.attributes.has("httponly"), "管理session CookieにHttpOnly属性がありません。");
    this.require(cookie.attributes.has("samesite=strict"), "管理session CookieにSameSite=Strictがありません。");
    return { observation: { cookieName: cookie.name, attributes, secure: true, httpOnly: true, sameSite: "Strict" } };
  }

  /** trusted proxy の header だけが管理面の transport/IP 判定へ影響することを検証する。 */
  private async proxyHeaderCase(): Promise<CaseOutcome> {
    const trusted = await this.client(this.profile.trustedProxyHeaders).login();
    this.require(trusted.authenticated, "trusted proxy header 経由の正規ログインが拒否されました。");
    if (this.profile.untrustedProxyUrl === undefined) {
      return { result: "NOT-APPLICABLE", observation: { trustedProxyAccepted: true, untrustedProxyEndpointConfigured: false }, detail: "未信頼送信元を再現する別 endpoint が設定されていません。" };
    }
    const untrusted = await this.client(this.profile.trustedProxyHeaders, this.profile.untrustedProxyUrl).login();
    this.require(untrusted.status === 403 && !untrusted.authenticated, "未信頼 proxy header がHTTPS管理面を有効化しました。");
    return { observation: { trustedProxyAccepted: true, untrustedProxyStatus: untrusted.status, untrustedProxyRejected: true } };
  }

  /** Resolver 側で生成した実SQLite受入れ証跡を検証する。 */
  private async sqliteEvidenceCase(): Promise<CaseOutcome> {
    if (this.profile.sqliteEvidencePath === undefined) {
      return { result: "NOT-APPLICABLE", observation: { evidenceConfigured: false }, detail: "Resolver側の実SQLite受入れ証跡が設定されていません。" };
    }
    const content = await readFile(this.profile.sqliteEvidencePath, "utf8");
    const evidence: unknown = JSON.parse(content);
    this.require(isRecord(evidence), "SQLite受入れ証跡の形式が不正です。");
    for (const key of ["concurrentAttempts", "expiredPurge", "boundedRows"] as const) {
      this.require(evidence[key] === true, `SQLite受入れ証跡の ${key} がPASSではありません。`);
    }
    return { observation: { evidencePath: this.profile.sqliteEvidencePath, concurrentAttempts: true, expiredPurge: true, boundedRows: true } };
  }

  /** 新しい認証済みセッションから対象 UUID が作成されていないことを確認する。 */
  private async requireRecordAbsent(uuid: string): Promise<void> {
    const client = this.client(this.profile.trustedProxyHeaders);
    const login = await client.login();
    this.require(login.authenticated, "mutation拒否後の再認証に失敗しました。");
    const response = await client.record(uuid);
    this.require(response.status === 404, `timeout後のmutationがUUID ${uuid} を作成しました。`);
  }

  /** profileの共通管理 client を生成する。 */
  private client(headers: Readonly<Record<string, string>> = {}, baseUrl = this.profile.baseUrl): AdminSecurityClient {
    return new AdminSecurityClient(this.http, this.profile, baseUrl, headers);
  }

  /** profileの信頼済み proxy 経由で client IP を指定する。 */
  private ipHeaders(ip: string): Readonly<Record<string, string>> {
    return { ...this.profile.trustedProxyHeaders, "x-forwarded-for": ip };
  }

  /** Resolver設定の秒数に少し余裕を加え、期限超過を確実にする。 */
  private async waitFor(seconds: number): Promise<void> {
    await this.waiter.wait(seconds * 1_000 + this.profile.waitGraceMilliseconds);
  }

  /** timeout後の未認証 login form を識別する。 */
  private isLoginPage(body: string): boolean {
    return body.includes('name="action" value="login"') && body.includes('name="username"');
  }

  /** timeout後の mutation が誤って登録されないよう固有の登録入力を生成する。 */
  private registrationFields(csrf: string, suffix: string): RegistrationFixture {
    const uuid = randomUUID();
    return {
      uuid,
      fields: { action: "register", csrf, uuid, state: "ACTIVE", location: `https://security.example/${suffix}/${uuid}.arxml`, entity_id: `https://security.example/entities/${uuid}` }
    };
  }

  /** ログイン成功条件を検査する。 */
  private require(condition: boolean, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }
}

interface CaseOutcome {
  readonly result?: SecurityResultClass;
  readonly observation: Readonly<Record<string, unknown>>;
  readonly detail?: string;
}

interface RegistrationFixture {
  readonly uuid: string;
  readonly fields: Readonly<Record<string, string>>;
}

/** ログインフォームから hidden CSRF token を抽出する。 */
function extractCsrf(body: string): string {
  return /name="csrf" value="([^"<>]+)"/.exec(body)?.[1] ?? "";
}

/** JSON object の最小実行時判定。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** catalog を未実行のまま追加していないことを、ビルド時に確認できる参照。 */
export const securityCaseCount = securityCases.length;
