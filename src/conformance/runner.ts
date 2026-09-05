// src/conformance/runner.ts

import { conformanceCatalog, CONFORMANCE_CATALOG_VERSION, findCatalogCase } from "./catalog.js";
import { assertNoDuplicateObjectMembers } from "./strictJson.js";
import type {
  CatalogCase,
  ConformanceHttpClient,
  ConformanceReport,
  ConformanceResult,
  ConformanceResultClass,
  ConformanceTarget,
  HttpResponseSnapshot,
  ResolverProfile
} from "./types.js";

const FIXTURES = {
  active: "550e8400-e29b-41d4-a716-446655440000",
  suspended: "550e8400-e29b-41d4-a716-446655440001",
  retired: "550e8400-e29b-41d4-a716-446655440002",
  lifecycle: "550e8400-e29b-41d4-a716-446655440003",
  suspendedLifecycle: "550e8400-e29b-41d4-a716-446655440004",
  versionOne: "550e8400-e29b-11d4-a716-446655440005",
  unsafe: "550e8400-e29b-41d4-a716-446655440006",
  integrity: "550e8400-e29b-41d4-a716-446655440007",
  duplicate: "550e8400-e29b-41d4-a716-446655440008",
  unknown: "550e8400-e29b-41d4-a716-446655440099"
} as const;

const LOCATION_A = "https://entity.example/description-a.arxml";
const LOCATION_B = "https://entity.example/description-b.arxml";
const ENTITY_ID = "https://identity.example/entities/test-fixture";
const INTEGRITY_DIGEST = "0000000000000000000000000000000000000000000000000000000000000000";
// 管理面のPOST後redirect追従で許可する最大遷移回数。
const MAX_ADMIN_REDIRECTS = 5;

interface ResolverRecordSnapshot {
  readonly uuid: string;
  readonly state: string;
  readonly location: string;
  readonly entity_id: string;
  readonly version?: number;
}

interface AdminRecordResponse {
  readonly record: ResolverRecordSnapshot;
  readonly history: readonly Record<string, unknown>[];
}

interface CaseOutcome {
  readonly result?: ConformanceResultClass;
  readonly observation: Readonly<Record<string, unknown>>;
  readonly detail?: string;
}

/** Resolver の認証済み管理面を操作する最小のセッション client。 */
class AdminClient {
  private readonly cookies = new Map<string, string>();
  private csrf = "";

  public constructor(private readonly http: ConformanceHttpClient, private readonly profile: ResolverProfile) {}

  public async login(): Promise<void> {
    const loginPage = await this.http.request({ url: this.adminUrl(), method: "GET" });
    this.saveCookies(loginPage);
    const loginResponse = await this.postForm({ action: "login", username: this.profile.adminUsername, password: this.profile.adminPassword });
    const response = await this.followAdminRedirects(loginResponse, "login");
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Admin login final response failed with HTTP ${response.status}.`);
    }
    this.csrf = this.extractCsrf(response.body);
    if (this.csrf === "") throw new Error("Admin login response did not contain a CSRF token.");
  }

  public async getRecord(uuid: string): Promise<AdminRecordResponse | null> {
    const url = new URL(this.adminUrl());
    url.searchParams.set("format", "json");
    url.searchParams.set("uuid", uuid);
    const response = await this.http.request({ url: url.toString(), method: "GET", headers: this.cookieHeaders() });
    this.saveCookies(response);
    if (response.status === 404) return null;
    if (response.status < 200 || response.status >= 300) throw new Error(`Admin record lookup failed with HTTP ${response.status}.`);
    return JSON.parse(response.body) as AdminRecordResponse;
  }

  private async form(fields: Readonly<Record<string, string>>): Promise<HttpResponseSnapshot> {
    const response = await this.postForm(fields);
    return this.followAdminRedirects(response, fields.action ?? "form");
  }

  /** 管理面へフォームを送信し、redirect前のraw応答を取得する。 */
  private async postForm(fields: Readonly<Record<string, string>>): Promise<HttpResponseSnapshot> {
    const body = new URLSearchParams(fields).toString();
    const response = await this.http.request({
      url: this.adminUrl(),
      method: "POST",
      headers: { ...this.cookieHeaders(), "content-type": "application/x-www-form-urlencoded" },
      body,
      redirect: "manual"
    });
    this.saveCookies(response);
    return response;
  }

  public async register(uuid: string, state: string, location: string, entityId = ENTITY_ID, integrity = false): Promise<HttpResponseSnapshot> {
    return this.form({
      action: "register",
      csrf: this.csrf,
      uuid,
      state,
      location,
      entity_id: entityId,
      ...(integrity ? { integrity_algorithm: "sha-256", integrity_digest: INTEGRITY_DIGEST } : {})
    });
  }

  public async updateLocation(uuid: string, location: string): Promise<HttpResponseSnapshot> {
    return this.form({ action: "location", csrf: this.csrf, uuid, location });
  }

  public async transition(uuid: string, state: string): Promise<HttpResponseSnapshot> {
    return this.form({ action: "transition", csrf: this.csrf, uuid, state, reason: "conformance fixture" });
  }

  private adminUrl(): string {
    return new URL(this.profile.adminUrl ?? "/admin.php", this.profile.baseUrl).toString();
  }

  /** 管理面POSTのredirectをCookie付きGETで手動追従する。 */
  private async followAdminRedirects(initialResponse: HttpResponseSnapshot, operation: string): Promise<HttpResponseSnapshot> {
    let response = initialResponse;
    for (let redirectCount = 0; response.status >= 300 && response.status < 400; redirectCount++) {
      if (redirectCount >= MAX_ADMIN_REDIRECTS) throw new Error(`Admin ${operation} redirect exceeded ${MAX_ADMIN_REDIRECTS} hops.`);
      const location = response.headers.location;
      if (location === undefined || location.trim() === "") throw new Error(`Admin ${operation} redirect response did not contain a Location header.`);
      const target = this.adminRedirectUrl(location, operation);
      response = await this.http.request({ url: target, method: "GET", headers: this.cookieHeaders(), redirect: "manual" });
      this.saveCookies(response);
    }
    return response;
  }

  /** 管理面redirect先を同一originに制限し、相対URLを解決する。 */
  private adminRedirectUrl(location: string, operation: string): string {
    let target: URL;
    try {
      target = new URL(location, this.adminUrl());
    } catch {
      throw new Error(`Admin ${operation} redirect Location is invalid.`);
    }
    const adminOrigin = new URL(this.adminUrl()).origin;
    if (target.origin !== adminOrigin) throw new Error(`Admin ${operation} redirect target must stay on the admin origin.`);
    return target.toString();
  }

  private cookieHeaders(): Record<string, string> {
    const value = [...this.cookies].map(([name, cookie]) => `${name}=${cookie}`).join("; ");
    return value === "" ? {} : { cookie: value };
  }

  private saveCookies(response: HttpResponseSnapshot): void {
    const header = response.headers["set-cookie"];
    if (header === undefined) return;
    for (const cookie of header.split(/,(?=[^;,]+=)/)) {
      const pair = cookie.split(";", 1)[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator > 0) this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  }

  private extractCsrf(body: string): string {
    return /name="csrf" value="([^"<>]+)"/.exec(body)?.[1] ?? "";
  }
}

/** 固定 fixture を管理面へ登録するために必要な事前条件。 */
async function prepareFixtures(admin: AdminClient): Promise<void> {
  const fixtures: readonly [string, string, string, boolean][] = [
    [FIXTURES.active, "ACTIVE", LOCATION_A, false],
    [FIXTURES.suspended, "SUSPENDED", LOCATION_A, false],
    [FIXTURES.retired, "RETIRED", LOCATION_A, false],
    [FIXTURES.lifecycle, "ACTIVE", LOCATION_A, false],
    [FIXTURES.suspendedLifecycle, "SUSPENDED", LOCATION_A, false],
    [FIXTURES.versionOne, "ACTIVE", LOCATION_A, false],
    [FIXTURES.integrity, "ACTIVE", LOCATION_A, true],
    [FIXTURES.duplicate, "ACTIVE", LOCATION_A, false]
  ];
  for (const [uuid, state, location, integrity] of fixtures) {
    const existing = await admin.getRecord(uuid);
    if (existing !== null) {
      if (existing.record.state !== state || existing.record.location !== location || existing.record.entity_id !== ENTITY_ID) {
        throw new Error(`Fixture ${uuid} already exists with incompatible state or location; use a fresh profile database.`);
      }
      continue;
    }
    const response = await admin.register(uuid, state, location, ENTITY_ID, integrity);
    const created = await admin.getRecord(uuid);
    if (response.status < 200 || response.status >= 300 || created?.record.state !== state || created.record.location !== location || created.record.entity_id !== ENTITY_ID) {
      throw new Error(`Fixture ${uuid} could not be registered.`);
    }
  }
}

/** Resolver / Manifest の外部観測可能な Frozen Catalog ケースを実行する。 */
export class ResolverConformanceRunner {
  public constructor(private readonly profile: ResolverProfile, private readonly http: ConformanceHttpClient) {}

  public async run(): Promise<ConformanceReport> {
    const admin = new AdminClient(this.http, this.profile);
    await admin.login();
    await prepareFixtures(admin);
    const executed = new Map<string, ConformanceResult>();
    const execute = async (caseId: string, operation: () => Promise<CaseOutcome>, executableTargets?: readonly ConformanceTarget[]): Promise<void> => {
      const catalogCase = findCatalogCase(caseId);
      const targets = executableTargets ?? catalogCase.targets;
      try {
        const outcome = await operation();
        for (const target of targets) executed.set(this.resultKey(caseId, target), this.result(catalogCase, target, outcome.result ?? "PASS", outcome.observation, outcome.detail));
      } catch (error: unknown) {
        for (const target of targets) executed.set(this.resultKey(caseId, target), this.result(catalogCase, target, "FAIL", {}, error instanceof Error ? error.message : String(error)));
      }
    };

    await execute("RES-001", () => this.expectStatus(FIXTURES.active, 303, LOCATION_A));
    await execute("RES-002", async () => {
      const update = await admin.updateLocation(FIXTURES.active, LOCATION_B);
      const response = await this.resolve(FIXTURES.active);
      const record = await admin.getRecord(FIXTURES.active);
      this.require(update.status >= 200 && update.status < 300 && record?.record.location === LOCATION_B, "Location update was not accepted.");
      return this.expect(response, 303, LOCATION_B);
    });
    await execute("RES-003", () => this.expectStatus(FIXTURES.unknown, 404));
    await execute("RES-004", async () => {
      const response = await admin.register(FIXTURES.unsafe, "ACTIVE", "http://unsafe.example/description.arxml");
      const publicResponse = await this.resolve(FIXTURES.unsafe);
      const record = await admin.getRecord(FIXTURES.unsafe);
      this.require(response.status >= 200 && response.status < 300 && record === null, "Unsafe Location was accepted by the admin surface.");
      this.require(publicResponse.status !== 303 || !this.hasUnsafeLocation(publicResponse), "Unsafe Location was emitted.");
      return { observation: { registrationStatus: response.status, publicStatus: publicResponse.status, adminRejected: true } };
    });
    await execute("ID-001", () => this.expectStatus(FIXTURES.active, 303, LOCATION_B));
    await execute("ID-002", () => this.expectStatus(FIXTURES.active.toUpperCase(), 303, LOCATION_B));
    await execute("ID-003", () => this.expectStatus(this.mixedCase(FIXTURES.active), 303, LOCATION_B));
    await execute("ID-004", () => this.expectStatus("not-a-uuid", 400));
    await execute("ID-005", () => this.expectStatus(FIXTURES.versionOne, 303, LOCATION_A));
    await execute("HTTP-001", async () => {
      const before = await admin.getRecord(FIXTURES.active);
      const first = await this.resolve(FIXTURES.active);
      const second = await this.resolve(FIXTURES.active);
      const after = await admin.getRecord(FIXTURES.active);
      this.require(before?.record.version === after?.record.version, "Public GET changed the record version.");
      return { observation: { first: this.snapshot(first), second: this.snapshot(second), versionBefore: before?.record.version, versionAfter: after?.record.version } };
    });
    await execute("HTTP-002", async () => {
      const response = await this.expectMethod(FIXTURES.active, "POST", 405);
      return { observation: this.snapshot(response) };
    });
    await execute("HTTP-003", async () => {
      const states = [FIXTURES.active, FIXTURES.suspended, FIXTURES.retired, FIXTURES.unknown];
      const responses = await Promise.all(states.map(uuid => this.expectMethod(uuid, "PUT", 405)));
      return { observation: { statuses: responses.map(response => response.status) } };
    });
    await execute("HTTP-004", () => this.expectStatus(FIXTURES.active, 501, undefined, "l=2"));
    await execute("HTTP-005", () => this.expectStatus(FIXTURES.active, 400, undefined, "p=reserved"));
    await execute("LIFE-001", () => this.expectStatus(FIXTURES.active, 303, LOCATION_B));
    await execute("LIFE-002", () => this.expectStatus(FIXTURES.suspended, 404));
    await execute("LIFE-003", () => this.expectStatus(FIXTURES.retired, 410));
    await execute("LIFE-004", async () => this.expectTransition(admin, FIXTURES.lifecycle, "SUSPENDED"));
    await execute("LIFE-005", async () => this.expectTransition(admin, FIXTURES.lifecycle, "ACTIVE"));
    await execute("LIFE-006", async () => this.expectTransition(admin, FIXTURES.lifecycle, "RETIRED"));
    await execute("LIFE-007", async () => this.expectTransition(admin, FIXTURES.suspendedLifecycle, "RETIRED"));
    await execute("LIFE-008", async () => this.expectRejectedTransition(admin, FIXTURES.lifecycle, "ACTIVE"));
    await execute("LIFE-009", async () => this.expectRejectedTransition(admin, FIXTURES.lifecycle, "SUSPENDED"));
    await execute("LIFE-010", async () => {
      const before = await this.manifest(FIXTURES.active);
      const update = await admin.updateLocation(FIXTURES.active, LOCATION_A);
      const after = await this.manifest(FIXTURES.active);
      const record = await admin.getRecord(FIXTURES.active);
      const beforeEntity = this.manifestEntityId(before.body);
      const afterEntity = this.manifestEntityId(after.body);
      this.require(update.status >= 200 && update.status < 300 && record?.record.state === "ACTIVE" && record.record.location === LOCATION_A, "Location update was not accepted.");
      this.require(beforeEntity === afterEntity, "Entity identity changed with Description Location.");
      this.require(this.manifestLocation(before.body) !== this.manifestLocation(after.body), "Description Location did not change.");
      return { observation: { entityIdBefore: beforeEntity, entityIdAfter: afterEntity, locationBefore: this.manifestLocation(before.body), locationAfter: this.manifestLocation(after.body) } };
    }, ["LIFECYCLE-ADMIN", "RESOLVER-SERVER"]);
    await execute("LIFE-011", async () => {
      const record = await admin.getRecord(FIXTURES.lifecycle);
      const transitions = record?.history.filter(item => item.event_type === "lifecycle_transition") ?? [];
      this.require(transitions.length >= 3, "Lifecycle transition history is incomplete.");
      this.require(transitions.every(item => typeof item.old_state === "string" && typeof item.new_state === "string" && typeof item.created_at === "string"), "Lifecycle history lacks state or timestamp fields.");
      return { observation: { transitionCount: transitions.length, history: transitions } };
    });
    await execute("LIFE-012", () => this.expectStatus(FIXTURES.lifecycle, 410));
    await execute("CACHE-001", () => this.expectHeader(FIXTURES.active, 303, "cache-control", "public, max-age="));
    await execute("CACHE-002", async () => {
      const response = await this.resolve(FIXTURES.active);
      const cache = response.headers["cache-control"] ?? "";
      return cache === "public, max-age=60"
        ? { observation: { cacheControl: cache } }
        : { result: "PASS-WITH-DEVIATION", observation: { cacheControl: cache }, detail: "Profile cache_max_age is not the catalog default of 60 seconds." };
    });
    await execute("CACHE-003", async () => {
      const responses = await Promise.all([
        this.resolve("not-a-uuid"),
        this.resolve(FIXTURES.unknown),
        this.resolve(FIXTURES.active, "?l=2")
      ]);
      for (const response of responses) this.require(response.headers["cache-control"] === "no-store", "A CACHE-003 error response did not use no-store.");
      return { observation: { subcases: responses.map(response => ({ status: response.status, cacheControl: response.headers["cache-control"] })) } };
    });
    await execute("CACHE-004", () => this.expectHeader(FIXTURES.retired, 410, "cache-control", "max-age="));
    await execute("CORS-001", () => this.expectHeader(FIXTURES.active, 303, "access-control-allow-origin", "*"));
    await execute("MAN-001", () => this.expectManifest(FIXTURES.active), ["MANIFEST-PRODUCER"]);
    await execute("MAN-003", () => this.expectManifest(FIXTURES.active), ["MANIFEST-PRODUCER"]);
    await execute("MAN-004", () => this.expectManifest(FIXTURES.duplicate), ["MANIFEST-PRODUCER"]);
    await execute("MAN-005", async () => {
      const response = await this.manifest(FIXTURES.active);
      const manifest = this.parseManifest(response.body);
      this.require(this.stringAt(manifest, ["anchor", "id"]).toLowerCase() === FIXTURES.active, "Manifest anchor.id does not match the request path.");
      return { observation: { status: response.status, anchorId: this.stringAt(manifest, ["anchor", "id"]) } };
    }, ["MANIFEST-ENDPOINT"]);
    await execute("MAN-006", async () => this.manifestIdentityCase(admin), ["MANIFEST-PRODUCER"]);
    await execute("MAN-008", async () => {
      const response = await this.manifest(FIXTURES.active);
      const location = this.manifestLocation(response.body);
      this.require(location.startsWith("https://"), "Manifest emitted a non-HTTPS L1 Description Location.");
      return { observation: { location } };
    }, ["MANIFEST-PRODUCER"]);
    await execute("MAN-009", () => this.expectStatus(FIXTURES.active, 303, LOCATION_B), ["RESOLVER-SERVER"]);
    await execute("MAN-010", () => this.expectManifest(FIXTURES.active));
    await execute("MAN-011", () => this.expectManifestStatus(FIXTURES.suspended, 404));
    await execute("MAN-012", () => this.expectManifestStatus(FIXTURES.retired, 410));
    await execute("MAN-013", () => this.expectManifestStatus(FIXTURES.unknown, 404));
    await execute("MAN-014", async () => {
      const response = await this.manifest(FIXTURES.active);
      const manifest = this.parseManifest(response.body);
      this.require(this.objectAt(manifest, ["description"])["integrity"] === undefined, "Baseline fixture unexpectedly contains integrity metadata.");
      return { observation: { status: response.status, integrityPresent: false } };
    }, ["MANIFEST-PRODUCER"]);
    await execute("MAN-015", async () => {
      const response = await this.manifest(FIXTURES.integrity);
      const integrity = this.objectAt(this.parseManifest(response.body), ["description"])["integrity"];
      this.objectAt(integrity, []);
      this.require(this.stringAt(integrity, ["algorithm"]) === "sha-256" && /^[0-9a-f]{64}$/.test(this.stringAt(integrity, ["digest"])), "sha-256 integrity syntax is invalid.");
      return { observation: { status: response.status, integrity } };
    }, ["MANIFEST-PRODUCER"]);
    await execute("MNET-001", async () => {
      const protocol = new URL(this.profile.baseUrl).protocol;
      return protocol === "https:"
        ? { observation: { baseProtocol: protocol } }
        : { result: "FAIL", observation: { baseProtocol: protocol }, detail: "The observed profile uses HTTP, but Manifest L1 retrieval requires HTTPS." };
    }, ["MANIFEST-ENDPOINT"]);

    for (const catalogCase of conformanceCatalog) {
      for (const target of catalogCase.targets) {
        const key = this.resultKey(catalogCase.id, target);
        if (!executed.has(key)) executed.set(key, this.result(catalogCase, target, "NOT-APPLICABLE", {}, this.notApplicableReason(catalogCase, target)));
      }
    }
    return {
      catalogVersion: this.profile.catalogVersion ?? CONFORMANCE_CATALOG_VERSION,
      profile: this.profile.name,
      resolverCommit: this.profile.resolverCommit,
      generatedAt: new Date().toISOString(),
      results: conformanceCatalog.flatMap(catalogCase => catalogCase.targets.map(target => executed.get(this.resultKey(catalogCase.id, target)) as ConformanceResult))
    };
  }

  private async resolve(uuid: string, query = ""): Promise<HttpResponseSnapshot> {
    const url = this.resourceUrl(uuid);
    if (query !== "") url.search = query;
    return this.http.request({ url: url.toString(), method: "GET" });
  }

  private async method(uuid: string, method: string): Promise<HttpResponseSnapshot> {
    return this.http.request({ url: this.resourceUrl(uuid).toString(), method });
  }

  private async manifest(uuid: string): Promise<HttpResponseSnapshot> {
    const url = this.resourceUrl(uuid);
    url.pathname += "/manifest";
    return this.http.request({ url: url.toString(), method: "GET" });
  }

  private resourceUrl(uuid: string): URL {
    const servicePath = this.profile.servicePath ?? "/relink";
    return new URL(`${servicePath.replace(/\/$/, "")}/${uuid}`, this.profile.baseUrl);
  }

  private async expectStatus(uuid: string, status: number, location?: string, query?: string): Promise<CaseOutcome> {
    return this.expect(await this.resolve(uuid, query === undefined ? "" : `?${query}`), status, location);
  }

  private async expectMethod(uuid: string, method: string, status: number): Promise<HttpResponseSnapshot> {
    const response = await this.method(uuid, method);
    this.require(response.status === status, `Expected HTTP ${status}, received ${response.status}.`);
    this.require(response.headers.allow === "GET", "Unsupported method response did not contain Allow: GET.");
    return response;
  }

  private async expectTransition(admin: AdminClient, uuid: string, state: string): Promise<CaseOutcome> {
    const response = await admin.transition(uuid, state);
    const record = await admin.getRecord(uuid);
    this.require(response.status >= 200 && response.status < 300 && record?.record.state === state, `Transition to ${state} was not accepted.`);
    return { observation: { state: record.record.state, version: record.record.version } };
  }

  private async expectRejectedTransition(admin: AdminClient, uuid: string, state: string): Promise<CaseOutcome> {
    const before = await admin.getRecord(uuid);
    const response = await admin.transition(uuid, state);
    const after = await admin.getRecord(uuid);
    this.require(response.status >= 200 && response.status < 300 && after?.record.state === "RETIRED" && before?.record.version === after.record.version, `Invalid transition to ${state} was accepted.`);
    return { observation: { attemptedState: state, responseStatus: response.status, state: after.record.state, version: after.record.version } };
  }

  private async expectHeader(uuid: string, status: number, header: string, expectedPart: string): Promise<CaseOutcome> {
    const response = await this.resolve(uuid);
    this.require(response.status === status, `Expected HTTP ${status}, received ${response.status}.`);
    const value = response.headers[header] ?? "";
    this.require(value.includes(expectedPart), `Header ${header} did not contain ${expectedPart}.`);
    return { observation: { status: response.status, [header]: value } };
  }

  private async expectManifest(uuid: string): Promise<CaseOutcome> {
    const response = await this.manifest(uuid);
    this.require(response.status === 200, `Expected Manifest HTTP 200, received ${response.status}.`);
    this.require((response.headers["content-type"] ?? "").startsWith("application/json"), "Manifest Content-Type is not application/json.");
    const manifest = this.parseManifest(response.body);
    for (const key of ["manifestVersion", "anchor", "entity", "description", "lifecycle"]) this.require(manifest[key] !== undefined, `Manifest is missing ${key}.`);
    this.require(this.stringAt(manifest, ["manifestVersion"]) === "0.1", "Manifest version is not 0.1.");
    this.require(["active", "suspended", "retired"].includes(this.stringAt(manifest, ["lifecycle", "status"])), "Manifest lifecycle status is invalid.");
    return { observation: { status: response.status, contentType: response.headers["content-type"], manifest } };
  }

  private async expectManifestStatus(uuid: string, status: number): Promise<CaseOutcome> {
    const response = await this.manifest(uuid);
    this.require(response.status === status, `Expected Manifest HTTP ${status}, received ${response.status}.`);
    return { observation: this.snapshot(response) };
  }

  private async manifestIdentityCase(admin: AdminClient): Promise<CaseOutcome> {
    const before = await this.manifest(FIXTURES.active);
    const update = await admin.updateLocation(FIXTURES.active, LOCATION_B);
    const after = await this.manifest(FIXTURES.active);
    const beforeJson = this.parseManifest(before.body);
    const afterJson = this.parseManifest(after.body);
    const record = await admin.getRecord(FIXTURES.active);
    this.require(update.status >= 200 && update.status < 300 && record?.record.location === LOCATION_B, "Location update was not accepted.");
    this.require(this.stringAt(beforeJson, ["entity", "id"]) === this.stringAt(afterJson, ["entity", "id"]), "Entity identity changed when Location changed.");
    return { observation: { entityId: this.stringAt(afterJson, ["entity", "id"]), location: this.stringAt(afterJson, ["description", "location"]) } };
  }

  private expect(response: HttpResponseSnapshot, status: number, location?: string): CaseOutcome {
    this.require(response.status === status, `Expected HTTP ${status}, received ${response.status}.`);
    if (location !== undefined) this.require(response.headers.location === location, `Expected Location ${location}, received ${response.headers.location ?? "<missing>"}.`);
    return { observation: this.snapshot(response) };
  }

  private resultKey(caseId: string, target: ConformanceTarget): string { return `${caseId}:${target}`; }

  private result(catalogCase: CatalogCase, target: ConformanceTarget, result: ConformanceResultClass, observation: Readonly<Record<string, unknown>>, detail?: string): ConformanceResult {
    return {
      catalogVersion: this.profile.catalogVersion ?? CONFORMANCE_CATALOG_VERSION,
      profile: this.profile.name,
      resolverCommit: this.profile.resolverCommit,
      target,
      caseId: catalogCase.id,
      strength: catalogCase.strength,
      result,
      observation,
      ...(detail === undefined ? {} : { detail })
    };
  }

  private notApplicableReason(catalogCase: CatalogCase, target: ConformanceTarget): string {
    if (target === "INTEGRITY-CONSUMER") return "Resolver profile does not claim Manifest integrity verification as a consumer.";
    if (target === "L1-CONSUMER" || target === "MANIFEST-CONSUMER") return "Consumer behavior is outside the Reference Resolver server/endpoint target.";
    return "The case requires an optional or non-server implementation surface not exposed by this profile.";
  }

  private snapshot(response: HttpResponseSnapshot): Readonly<Record<string, unknown>> {
    return { status: response.status, headers: response.headers, body: response.body.slice(0, 4_000) };
  }

  private parseJson(body: string): Record<string, unknown> {
    const value: unknown = JSON.parse(body);
    return this.objectAt(value, []);
  }

  private parseManifest(body: string): Record<string, unknown> {
    assertNoDuplicateObjectMembers(body);
    return this.parseJson(body);
  }

  private objectAt(value: unknown, path: readonly string[]): Record<string, unknown> {
    let current = value;
    for (const key of path) {
      this.require(typeof current === "object" && current !== null && !Array.isArray(current), `Expected object before ${key}.`);
      current = (current as Record<string, unknown>)[key];
    }
    this.require(typeof current === "object" && current !== null && !Array.isArray(current), "Expected a JSON object.");
    return current as Record<string, unknown>;
  }

  private stringAt(value: unknown, path: readonly string[]): string {
    let current: unknown = value;
    for (const key of path) {
      this.require(typeof current === "object" && current !== null && !Array.isArray(current), `Expected object before ${key}.`);
      current = (current as Record<string, unknown>)[key];
    }
    this.require(typeof current === "string", `Expected string at ${path.join(".")}.`);
    return current;
  }

  private manifestEntityId(body: string): string { return this.stringAt(this.parseManifest(body), ["entity", "id"]); }

  private manifestLocation(body: string): string { return this.stringAt(this.parseManifest(body), ["description", "location"]); }

  private mixedCase(value: string): string {
    return [...value].map((character, index) => index % 3 === 0 ? character.toUpperCase() : character).join("");
  }

  private hasUnsafeLocation(response: HttpResponseSnapshot): boolean {
    const location = response.headers.location ?? "";
    return !location.startsWith("https://");
  }

  private require(condition: boolean, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }
}
