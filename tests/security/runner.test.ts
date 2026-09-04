// tests/security/runner.test.ts

import { describe, expect, it } from "vitest";
import { AdminSecurityAcceptanceRunner } from "../../src/security/runner.js";
import type { SecurityHttpClient, SecurityHttpRequest, SecurityHttpResponse, SecurityProfile } from "../../src/security/types.js";

/** 外部管理面の最小契約を再現し、時間とネットワークに依存しない受入れ runner を検証する。 */
class MockAdminClient implements SecurityHttpClient {
  private readonly failures = new Map<string, number>();
  private readonly sessions = new Map<string, { csrf: string; authenticated: boolean; authenticatedAtMilliseconds: number; lastActivityMilliseconds: number }>();
  private readonly records = new Set<string>();
  private sequence = 0;
  private nowMilliseconds = 0;

  public constructor(private readonly maxFailures: number, private readonly idleTimeoutSeconds = 1, private readonly absoluteTimeoutSeconds = 1) {}

  /** runnerの待機時間を進める仮想時計。 */
  public advance(milliseconds: number): void {
    this.nowMilliseconds += milliseconds;
  }

  /** 認証制限の期限を進めるテスト用時計。 */
  public releaseLockout(): void {
    this.failures.clear();
  }

  /** 管理画面と mutation の外部 HTTP 契約を再現する。 */
  public async request(request: SecurityHttpRequest): Promise<SecurityHttpResponse> {
    const url = new URL(request.url);
    const cookie = this.cookie(request.headers?.cookie);
    const session = cookie === undefined ? undefined : this.activeSession(cookie);
    if (request.method === "GET" && url.searchParams.get("format") === "json") {
      if (session?.authenticated !== true) return this.loginResponse();
      const uuid = url.searchParams.get("uuid") ?? "";
      return this.response(this.records.has(uuid) ? 200 : 404, this.records.has(uuid) ? JSON.stringify({ record: { uuid } }) : "{}");
    }
    if (request.method === "GET") {
      if (session?.authenticated === true) {
        session.lastActivityMilliseconds = this.nowMilliseconds;
        return this.protectedResponse(session.csrf);
      }
      return cookie === undefined ? this.loginResponse(true) : this.loginResponse();
    }
    const fields = new URLSearchParams(request.body ?? "");
    if (fields.get("action") === "login") {
      const ip = request.headers?.["x-forwarded-for"] ?? "127.0.0.1";
      const valid = fields.get("username") === "admin" && fields.get("password") === "secret";
      const failures = this.failures.get(ip) ?? 0;
      if (!valid || failures >= this.maxFailures) {
        if (!valid) this.failures.set(ip, failures + 1);
        return this.loginResponse();
      }
      const id = `session-${++this.sequence}`;
      const csrf = `csrf-${this.sequence}`;
      this.sessions.set(id, { csrf, authenticated: true, authenticatedAtMilliseconds: this.nowMilliseconds, lastActivityMilliseconds: this.nowMilliseconds });
      return { status: 303, headers: { location: "/admin.php", "set-cookie": `PHPSESSID=${id}; Secure; HttpOnly; SameSite=Strict` }, body: "" };
    }
    if (session?.authenticated !== true) return this.loginResponse();
    if (fields.get("csrf") !== session.csrf) return this.response(403, "CSRF validation failed");
    if (fields.get("action") === "register") this.records.add(fields.get("uuid") ?? "");
    return this.response(303, "", { location: "/admin.php" });
  }

  private protectedResponse(csrf: string): SecurityHttpResponse {
    return this.response(200, `<form><input type="hidden" name="csrf" value="${csrf}"><input name="username"></form>`);
  }

  private loginResponse(setCookie = false): SecurityHttpResponse {
    return this.response(200, '<form><input type="hidden" name="action" value="login"><input name="username"></form>', setCookie ? { "set-cookie": "PHPSESSID=anonymous; Secure; HttpOnly; SameSite=Strict" } : {});
  }

  private response(status: number, body: string, headers: Record<string, string> = {}): SecurityHttpResponse {
    return { status, headers, body };
  }

  private cookie(header: string | undefined): string | undefined {
    return /(?:^|; )PHPSESSID=([^;]+)/.exec(header ?? "")?.[1];
  }

  /** idle / absolute期限を仮想時計で判定する。 */
  private activeSession(cookie: string): { csrf: string; authenticated: boolean; authenticatedAtMilliseconds: number; lastActivityMilliseconds: number } | undefined {
    const session = this.sessions.get(cookie);
    if (session === undefined) return undefined;
    if (this.nowMilliseconds - session.lastActivityMilliseconds >= this.idleTimeoutSeconds * 1_000 || this.nowMilliseconds - session.authenticatedAtMilliseconds >= this.absoluteTimeoutSeconds * 1_000) {
      session.authenticated = false;
    }
    return session;
  }
}

function profile(): SecurityProfile {
  return {
    name: "native",
    baseUrl: "http://resolver.test",
    adminUsername: "admin",
    adminPassword: "secret",
    loginMaxFailures: 3,
    loginLockoutSeconds: 1,
    sessionIdleSeconds: 1,
    sessionAbsoluteSeconds: 1,
    waitGraceMilliseconds: 1,
    trustedProxyHeaders: { "x-forwarded-proto": "https", "x-forwarded-for": "198.51.100.10" }
  };
}

describe("AdminSecurityAcceptanceRunner", () => {
  it("管理認証の HTTP 受入れケースを実行し、SQLite 証跡なしを明示する", async () => {
    const client = new MockAdminClient(3, 1, 1);
    let waits = 0;
    const report = await new AdminSecurityAcceptanceRunner(profile(), client, {
      wait: async milliseconds => {
        waits++;
        client.advance(milliseconds);
        if (waits === 1) client.releaseLockout();
      }
    }).run();

    expect(report.reportVersion).toBe("admin-security-0.1");
    expect(report.results).toHaveLength(7);
    expect(report.results.filter(result => result.result === "FAIL")).toHaveLength(0);
    expect(report.results.filter(result => result.result === "PASS").map(result => result.caseId)).toEqual([
      "AUTH-001", "AUTH-002", "SESSION-001", "SESSION-002", "COOKIE-001"
    ]);
    expect(report.results.find(result => result.caseId === "SESSION-002")?.observation).toMatchObject({ absoluteRefreshCount: expect.any(Number) });
    expect((report.results.find(result => result.caseId === "SESSION-002")?.observation.absoluteRefreshCount as number)).toBeGreaterThan(0);
    expect(report.results.find(result => result.caseId === "PROXY-001")?.result).toBe("NOT-APPLICABLE");
    expect(report.results.find(result => result.caseId === "SQLITE-001")?.result).toBe("NOT-APPLICABLE");
  });
});
