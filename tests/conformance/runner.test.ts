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

/** Resolver の外部契約だけを再現し、runner の実行順序をネットワークなしで検証する。 */
class MockResolverClient implements ConformanceHttpClient {
  private readonly records = new Map<string, MockRecord>();

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
    if (request.method !== "POST") return this.response(200, "<form method=\"post\">");
    const fields = new URLSearchParams(request.body ?? "");
    const action = fields.get("action") ?? "";
    if (action === "") return this.response(200, "<form method=\"post\"><input name=\"csrf\" value=\"csrf-token\">");
    const uuid = (fields.get("uuid") ?? "").toLowerCase();
    if (action === "register") {
      const location = fields.get("location") ?? "";
      if (!location.startsWith("https://") || this.records.has(uuid)) return this.response(200, "操作に失敗しました");
      this.records.set(uuid, { state: fields.get("state") ?? "ACTIVE", location, entity_id: fields.get("entity_id") ?? "", version: 1, history: [], ...(fields.has("integrity_algorithm") ? { integrity: { algorithm: "sha-256", digest: fields.get("integrity_digest") ?? "" } } : {}) });
      return this.response(200, "登録しました");
    }
    const record = this.records.get(uuid);
    if (record === undefined) return this.response(200, "操作に失敗しました");
    if (action === "location") {
      const oldLocation = record.location;
      record.location = fields.get("location") ?? "";
      record.version += 1;
      record.history.unshift({ event_type: "mapping_update", old_location: oldLocation, new_location: record.location, created_at: "2026-09-04 00:00:00" });
      return this.response(200, "更新しました");
    }
    if (action === "transition") {
      const next = fields.get("state") ?? "";
      const allowed = [`ACTIVE:${"SUSPENDED"}`, `SUSPENDED:${"ACTIVE"}`, `ACTIVE:${"RETIRED"}`, `SUSPENDED:${"RETIRED"}`];
      if (record.state === next || !allowed.includes(`${record.state}:${next}`)) return record.state === next ? this.response(200, "変更しました") : this.response(200, "操作に失敗しました");
      const previous = record.state;
      record.state = next;
      record.version += 1;
      record.history.unshift({ event_type: "lifecycle_transition", old_state: previous, new_state: next, created_at: "2026-09-04 00:00:00" });
      return this.response(200, "変更しました");
    }
    return this.response(200, "操作に失敗しました");
  }

  private publicEndpoint(request: HttpRequest, url: URL): HttpResponseSnapshot {
    const match = /^\/relink\/([^/]+)(\/manifest)?$/.exec(url.pathname);
    if (match === null || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(match[1] ?? "")) return this.response(400, "", { "cache-control": "no-store" });
    const uuid = (match[1] ?? "").toLowerCase();
    const record = this.records.get(uuid);
    if (match[2] !== undefined) {
      if (record === undefined || record.state === "SUSPENDED") return this.response(404, "", { "cache-control": "no-store" });
      if (record.state === "RETIRED") return this.response(410, "", { "cache-control": "public, max-age=300" });
      const manifest = { manifestVersion: "0.1", anchor: { id: uuid }, entity: { id: record.entity_id }, description: { location: record.location, ...(record.integrity === undefined ? {} : { integrity: record.integrity }) }, lifecycle: { status: record.state.toLowerCase() } };
      return this.response(200, JSON.stringify(manifest), { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60", "access-control-allow-origin": "*" });
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

describe("ResolverConformanceRunner", () => {
  it("produces target-specific normalized results without external network access", async () => {
    const profile: ResolverProfile = {
      name: "test",
      baseUrl: "http://resolver.test",
      adminUsername: "admin",
      adminPassword: "test-password",
      resolverCommit: "4b08eead4bcc23374044bb60340bb915102a29db"
    };
    const report = await new ResolverConformanceRunner(profile, new MockResolverClient()).run();
    expect(report.results.filter(result => result.result === "FAIL").map(result => result.caseId)).toEqual(["MNET-001"]);
    expect(report.results.find(result => result.caseId === "HTTP-003")?.target).toBe("RESOLVER-SERVER");
    expect(report.results.filter(result => result.caseId === "MAN-001").map(result => [result.target, result.result])).toEqual([
      ["MANIFEST-CONSUMER", "NOT-APPLICABLE"],
      ["MANIFEST-PRODUCER", "PASS"]
    ]);
    expect(report.results.find(result => result.caseId === "INT-008")?.result).toBe("NOT-APPLICABLE");
    expect(report.results.find(result => result.caseId === "MNET-001")?.result).toBe("FAIL");
  });
});
