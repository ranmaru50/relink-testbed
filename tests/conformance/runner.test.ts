// tests/conformance/runner.test.ts

import { describe, expect, it } from "vitest";
import { ResolverConformanceRunner } from "../../src/conformance/runner.js";
import type { ConformanceHttpClient, HttpRequest, HttpResponseSnapshot, ResolverProfile } from "../../src/conformance/types.js";

interface MockRecord {
  state: string;
  location: string;
  entity_id: string;
  version: number;
  integrity?: { algorithm: string; digest: string };
  history: Record<string, unknown>[];
}

type LoginResponseMode = "success" | "redirect" | "missing-location" | "external" | "final-error";
type AdminOperation = "register" | "location" | "transition" | "all";
type AdminOperationResponseMode = "success" | "redirect" | "missing-location" | "external" | "too-many";

interface ObservedAdminRedirect {
  readonly action: string;
  readonly cookie: string;
}

/** Resolver の外部契約だけを再現し、runner の実行順序をネットワークなしで検証する。 */
class MockResolverClient implements ConformanceHttpClient {
  private readonly records = new Map<string, MockRecord>();
  /** ログインPOSTで受信した action 値を回帰テストから確認するための記録。 */
  private readonly loginActions: string[] = [];
  /** ログイン後GETへ渡されたCookieを回帰テストから確認するための記録。 */
  private readonly loginRedirectCookies: string[] = [];
  /** 管理操作POST後のredirect GETへ渡されたCookieを記録する。 */
  private readonly adminRedirects: ObservedAdminRedirect[] = [];

  public constructor(
    private readonly duplicateManifest?: "top-level" | "nested",
    private readonly loginResponseMode: LoginResponseMode = "success",
    private readonly adminOperation: AdminOperation = "all",
    private readonly adminOperationResponseMode: AdminOperationResponseMode = "success"
  ) {}

  /** ログインPOSTが期待する action を送信したことを返す。 */
  public get observedLoginActions(): readonly string[] {
    return this.loginActions;
  }

  /** ログイン後GETへ渡されたCookieを返す。 */
  public get observedLoginRedirectCookies(): readonly string[] {
    return this.loginRedirectCookies;
  }

  /** 管理操作redirect GETの内容を返す。 */
  public get observedAdminRedirects(): readonly ObservedAdminRedirect[] {
    return this.adminRedirects;
  }

  public async request(request: HttpRequest): Promise<HttpResponseSnapshot> {
    const url = new URL(request.url);
    if (url.pathname === "/admin.php") return this.admin(request, url);
    return this.publicEndpoint(request, url);
  }

  private admin(request: HttpRequest, url: URL): HttpResponseSnapshot {
    if (request.method === "GET" && url.searchParams.get("format") === "json") {
      const uuid = url.searchParams.get("uuid")?.toLowerCase() ?? "";
      const record = this.records.get(uuid);
      return record === undefined ? this.response(404) : this.response(200, JSON.stringify({ record: { uuid, state: record.state, location: record.location, entity_id: record.entity_id, version: record.version }, history: record.history }));
    }
    if (request.method !== "POST") {
      const operation = url.searchParams.get("operation");
      if (operation !== null) {
        const hop = Number(url.searchParams.get("hop") ?? "0");
        if (this.adminOperationResponseMode === "too-many" && hop <= 5) {
          return this.response(302, "", { location: `/admin.php?operation=${operation}&hop=${hop + 1}` });
        }
        this.adminRedirects.push({ action: operation, cookie: request.headers?.cookie ?? "" });
        return this.response(200, "操作を完了しました");
      }
      if (url.searchParams.get("login") === "redirected") {
        this.loginRedirectCookies.push(request.headers?.cookie ?? "");
        return this.response(200, "<form method=\"post\"><input name=\"csrf\" value=\"csrf-token\">");
      }
      if (url.searchParams.get("login") === "error") return this.response(500, "login failed");
      return this.response(200, "<form method=\"post\">");
    }
    const fields = new URLSearchParams(request.body ?? "");
    const action = fields.get("action") ?? "";
    if (!fields.has("uuid")) {
      this.loginActions.push(action);
      if (action === "login") {
        if (this.loginResponseMode === "redirect") return this.response(302, "", { location: "/admin.php?login=redirected", "set-cookie": "PHPSESSID=authenticated" });
        if (this.loginResponseMode === "missing-location") return this.response(302, "");
        if (this.loginResponseMode === "external") return this.response(302, "", { location: "https://attacker.example/login" });
        if (this.loginResponseMode === "final-error") return this.response(302, "", { location: "/admin.php?login=error" });
        return this.response(200, "<form method=\"post\"><input name=\"csrf\" value=\"csrf-token\">");
      }
      return this.response(200, "<form method=\"post\">");
    }
    const uuid = (fields.get("uuid") ?? "").toLowerCase();
    if (action === "register") {
      const location = fields.get("location") ?? "";
      if (!location.startsWith("https://") || this.records.has(uuid)) return this.adminOperationResult(action, this.response(200, "操作に失敗しました"));
      this.records.set(uuid, { state: fields.get("state") ?? "ACTIVE", location, entity_id: fields.get("entity_id") ?? "", version: 1, history: [], ...(fields.has("integrity_algorithm") ? { integrity: { algorithm: "sha-256", digest: fields.get("integrity_digest") ?? "" } } : {}) });
      return this.adminOperationResult(action, this.response(200, "登録しました"));
    }
    const record = this.records.get(uuid);
    if (record === undefined) return this.adminOperationResult(action, this.response(200, "操作に失敗しました"));
    if (action === "location") {
      const oldLocation = record.location;
      record.location = fields.get("location") ?? "";
      record.version += 1;
      record.history.unshift({ event_type: "mapping_update", old_location: oldLocation, new_location: record.location, created_at: "2026-09-04 00:00:00" });
      return this.adminOperationResult(action, this.response(200, "更新しました"));
    }
    if (action === "transition") {
      const next = fields.get("state") ?? "";
      const allowed = [`ACTIVE:${"SUSPENDED"}`, `SUSPENDED:${"ACTIVE"}`, `ACTIVE:${"RETIRED"}`, `SUSPENDED:${"RETIRED"}`];
      if (record.state === next || !allowed.includes(`${record.state}:${next}`)) {
        return this.adminOperationResult(action, record.state === next ? this.response(200, "変更しました") : this.response(200, "操作に失敗しました"));
      }
      const previous = record.state;
      record.state = next;
      record.version += 1;
      record.history.unshift({ event_type: "lifecycle_transition", old_state: previous, new_state: next, created_at: "2026-09-04 00:00:00" });
      return this.adminOperationResult(action, this.response(200, "変更しました"));
    }
    return this.adminOperationResult(action, this.response(200, "操作に失敗しました"));
  }

  /** 指定された管理操作だけをredirect対象にする。 */
  private shouldRedirectAdminOperation(action: string): boolean {
    return this.adminOperationResponseMode !== "success" && (this.adminOperation === "all" || this.adminOperation === action);
  }

  /** 管理操作の状態変更後に、必要ならPRG形式のredirect応答へ置き換える。 */
  private adminOperationResult(action: string, fallback: HttpResponseSnapshot): HttpResponseSnapshot {
    return this.shouldRedirectAdminOperation(action) ? this.adminOperationResponse(action) : fallback;
  }

  /** 管理操作POSTのredirect応答を生成する。 */
  private adminOperationResponse(action: string): HttpResponseSnapshot {
    if (this.adminOperationResponseMode === "missing-location") return this.response(302, "", { "set-cookie": "operation=redirected" });
    if (this.adminOperationResponseMode === "external") return this.response(302, "", { location: "https://attacker.example/admin", "set-cookie": "operation=redirected" });
    if (this.adminOperationResponseMode === "too-many") return this.response(302, "", { location: `/admin.php?operation=${action}&hop=1`, "set-cookie": "operation=redirected" });
    return this.response(302, "", { location: `/admin.php?operation=${action}`, "set-cookie": "operation=redirected" });
  }

  private publicEndpoint(request: HttpRequest, url: URL): HttpResponseSnapshot {
    const match = /^\/relink\/([^/]+)(\/manifest)?$/.exec(url.pathname);
    if (match === null || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(match[1] ?? "")) return this.response(400, "", { "cache-control": "no-store" });
    const uuid = (match[1] ?? "").toLowerCase();
    const record = this.records.get(uuid);
    if (match[2] !== undefined) {
      if (record === undefined || record.state === "SUSPENDED") return this.response(404, "", { "cache-control": "no-store" });
      if (record.state === "RETIRED") return this.response(410, "", { "cache-control": "public, max-age=300" });
      const body = uuid === "550e8400-e29b-41d4-a716-446655440008" && this.duplicateManifest === "top-level"
        ? `{"manifestVersion":"0.1","anchor":{"id":"${uuid}"},"anchor":{"id":"${uuid}"},"entity":{"id":"${record.entity_id}"},"description":{"location":"${record.location}"},"lifecycle":{"status":"${record.state.toLowerCase()}"}}`
        : uuid === "550e8400-e29b-41d4-a716-446655440008" && this.duplicateManifest === "nested"
          ? `{"manifestVersion":"0.1","anchor":{"id":"${uuid}","id":"${uuid}"},"entity":{"id":"${record.entity_id}"},"description":{"location":"${record.location}"},"lifecycle":{"status":"${record.state.toLowerCase()}"}}`
          : JSON.stringify({ manifestVersion: "0.1", anchor: { id: uuid }, entity: { id: record.entity_id }, description: { location: record.location, ...(record.integrity === undefined ? {} : { integrity: record.integrity }) }, lifecycle: { status: record.state.toLowerCase() } });
      return this.response(200, body, { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60", "access-control-allow-origin": "*" });
    }
    if (request.method !== "GET") return this.response(405, "", { allow: "GET", "cache-control": "no-store" });
    if (url.searchParams.has("l")) return this.response(501, "", { "cache-control": "no-store" });
    if (url.searchParams.has("p")) return this.response(400, "", { "cache-control": "no-store" });
    if (record === undefined || record.state === "SUSPENDED") return this.response(404, "", { "cache-control": "no-store" });
    if (record.state === "RETIRED") return this.response(410, "", { "cache-control": "public, max-age=300" });
    return this.response(303, "", { location: record.location, "cache-control": "public, max-age=60", "access-control-allow-origin": "*" });
  }

  private response(status: number, body = "", headers: Record<string, string> = {}): HttpResponseSnapshot {
    return { status, body, headers };
  }
}

/** runner の回帰テストで共有する最小の Resolver profile を生成する。 */
function createTestProfile(): ResolverProfile {
  return {
    name: "test",
    baseUrl: "http://resolver.test",
    adminUsername: "admin",
    adminPassword: "test-password",
    resolverCommit: "4b08eead4bcc23374044bb60340bb915102a29db"
  };
}

describe("ResolverConformanceRunner", () => {
  it("produces target-specific normalized results without external network access", async () => {
    const profile: ResolverProfile = {
      name: "test",
      baseUrl: "http://resolver.test",
      adminUsername: "admin",
      adminPassword: "test-password",
      resolverCommit: "4b08eead4bcc23374044bb60340bb915102a29db"
    };
    const client = new MockResolverClient();
    const report = await new ResolverConformanceRunner(profile, client).run();
    expect(client.observedLoginActions).toEqual(["login"]);
    expect(report.results.filter(result => result.result === "FAIL").map(result => result.caseId)).toEqual(["MNET-001"]);
    expect(report.results.find(result => result.caseId === "HTTP-003")?.target).toBe("RESOLVER-SERVER");
    expect(report.results.filter(result => result.caseId === "MAN-001").map(result => [result.target, result.result])).toEqual([
      ["MANIFEST-CONSUMER", "NOT-APPLICABLE"],
      ["MANIFEST-PRODUCER", "PASS"]
    ]);
    expect(report.results.find(result => result.caseId === "INT-008")?.result).toBe("NOT-APPLICABLE");
    expect(report.results.find(result => result.caseId === "MNET-001")?.result).toBe("FAIL");
  });

  it("follows a successful login redirect while preserving the session Cookie", async () => {
    const profile: ResolverProfile = {
      name: "test",
      baseUrl: "http://resolver.test",
      adminUsername: "admin",
      adminPassword: "test-password",
      resolverCommit: "4b08eead4bcc23374044bb60340bb915102a29db"
    };
    const client = new MockResolverClient(undefined, "redirect");

    await new ResolverConformanceRunner(profile, client).run();

    expect(client.observedLoginRedirectCookies).toEqual(["PHPSESSID=authenticated"]);
  });

  it.each(["register", "location", "transition"] as const)("follows a 302 redirect for the %s operation with cookies", async operation => {
    const client = new MockResolverClient(undefined, "success", operation, "redirect");
    const report = await new ResolverConformanceRunner(createTestProfile(), client).run();

    expect(report.results.filter(result => result.result === "FAIL").map(result => result.caseId)).toEqual(["MNET-001"]);
    expect(client.observedAdminRedirects.length).toBeGreaterThan(0);
    expect(client.observedAdminRedirects.every(redirect => redirect.action === operation && redirect.cookie.includes("operation=redirected"))).toBe(true);
  });

  it.each([
    ["missing-location", "Admin register redirect response did not contain a Location header."],
    ["external", "Admin register redirect target must stay on the admin origin."],
    ["too-many", "Admin register redirect exceeded 5 hops."]
  ] as const)("rejects an invalid management redirect (%s)", async (responseMode, message) => {
    const client = new MockResolverClient(undefined, "success", "register", responseMode);

    await expect(new ResolverConformanceRunner(createTestProfile(), client).run()).rejects.toThrow(message);
  });

  it.each([
    ["missing-location", "Admin login redirect response did not contain a Location header."],
    ["external", "Admin login redirect target must stay on the admin origin."],
    ["final-error", "Admin login final response failed with HTTP 500."]
  ] as const)("rejects an invalid login redirect (%s)", async (loginResponseMode, message) => {
    const profile: ResolverProfile = {
      name: "test",
      baseUrl: "http://resolver.test",
      adminUsername: "admin",
      adminPassword: "test-password",
      resolverCommit: "4b08eead4bcc23374044bb60340bb915102a29db"
    };

    await expect(new ResolverConformanceRunner(profile, new MockResolverClient(undefined, loginResponseMode)).run()).rejects.toThrow(message);
  });

  it.each(["top-level", "nested"] as const)("fails MAN-004 when the producer emits a %s duplicate member", async duplicateManifest => {
    const profile: ResolverProfile = {
      name: "test",
      baseUrl: "http://resolver.test",
      adminUsername: "admin",
      adminPassword: "test-password",
      resolverCommit: "4b08eead4bcc23374044bb60340bb915102a29db"
    };
    const report = await new ResolverConformanceRunner(profile, new MockResolverClient(duplicateManifest)).run();
    const result = report.results.find(candidate => candidate.caseId === "MAN-004" && candidate.target === "MANIFEST-PRODUCER");
    expect(result?.result).toBe("FAIL");
    expect(result?.detail).toContain("duplicate member");
  });
});
