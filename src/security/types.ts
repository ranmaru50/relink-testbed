// src/security/types.ts

/** 管理認証セキュリティ受入れ runner で共有する型を定義する。 */

export const SECURITY_RESULT_CLASSES = ["PASS", "FAIL", "NOT-APPLICABLE"] as const;

export type SecurityResultClass = typeof SECURITY_RESULT_CLASSES[number];

export type SecurityCaseId =
  | "AUTH-001"
  | "AUTH-002"
  | "SESSION-001"
  | "SESSION-002"
  | "COOKIE-001"
  | "PROXY-001"
  | "SQLITE-001";

/** 管理認証受入れケースの定義。Frozen Catalog の case ID とは独立している。 */
export interface SecurityCaseDefinition {
  readonly id: SecurityCaseId;
  readonly description: string;
  readonly scope: "http" | "sqlite-evidence";
}

/** セキュリティ受入れ対象の Native / Container profile。 */
export interface SecurityProfile {
  readonly name: "native" | "container";
  readonly baseUrl: string;
  readonly adminUrl?: string;
  readonly adminUsername: string;
  readonly adminPassword: string;
  readonly loginMaxFailures: number;
  readonly loginLockoutSeconds: number;
  readonly sessionIdleSeconds: number;
  readonly sessionAbsoluteSeconds: number;
  readonly waitGraceMilliseconds: number;
  readonly trustedProxyHeaders: Readonly<Record<string, string>>;
  readonly untrustedProxyUrl?: string;
  readonly sqliteEvidencePath?: string;
}

/** HTTP client に渡す管理リクエスト。 */
export interface SecurityHttpRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly redirect?: "error" | "follow" | "manual";
}

/** セキュリティ受入れで観測する HTTP 応答。 */
export interface SecurityHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** 外部 HTTP client の差し替えポート。 */
export interface SecurityHttpClient {
  request(request: SecurityHttpRequest): Promise<SecurityHttpResponse>;
}

/** Cookie の属性を含む Set-Cookie の観測値。 */
export interface ObservedCookie {
  readonly name: string;
  readonly value: string;
  readonly attributes: ReadonlySet<string>;
  readonly raw: string;
}

/** 1件の受入れ結果。 */
export interface SecurityResult {
  readonly profile: SecurityProfile["name"];
  readonly caseId: SecurityCaseId;
  readonly result: SecurityResultClass;
  readonly observation: Readonly<Record<string, unknown>>;
  readonly detail?: string;
}

/** profile 単位で保存する受入れ結果 artifact。 */
export interface SecurityReport {
  readonly reportVersion: "admin-security-0.1";
  readonly profile: SecurityProfile["name"];
  readonly generatedAt: string;
  readonly results: readonly SecurityResult[];
}
