// src/security/headerTypes.ts

/** Resolver の HTTP セキュリティヘッダー受入れで共有する型を定義する。 */

export const HEADER_SECURITY_RESULT_CLASSES = [
  "PASS",
  "FAIL",
  "PASS-WITH-DEVIATION",
  "NOT-APPLICABLE",
  "UNSUPPORTED-OPTIONAL"
] as const;

export type HeaderSecurityResultClass = typeof HEADER_SECURITY_RESULT_CLASSES[number];

export type HeaderSecurityScenarioId =
  | "NATIVE-HTTPS-PUBLIC"
  | "NATIVE-HTTPS-MANIFEST"
  | "NATIVE-HTTPS-ADMIN"
  | "NATIVE-HTTPS-APACHE-ERROR"
  | "NATIVE-HTTPS-TRACE"
  | "NATIVE-HTTPS-REDIRECT"
  | "NATIVE-HTTPS-4XX"
  | "NATIVE-HTTPS-5XX"
  | "NATIVE-HTTP-DEVELOPMENT"
  | "CONTAINER-PUBLIC-400"
  | "CONTAINER-PUBLIC-503"
  | "CONTAINER-ADMIN-200"
  | "CONTAINER-TRACE-405"
  | "CONTAINER-SUCCESS-REDIRECT";

/** Node.js の rawHeaders から得た 1 つの HTTP header field。 */
export interface RawHeaderField {
  readonly name: string;
  readonly value: string;
}

/** 重複 field を失わない HTTP 応答 snapshot。 */
export interface HeaderHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawHeaders: readonly RawHeaderField[];
  readonly body: string;
}

/** HTTP header 受入れ runner へ注入するリクエスト。 */
export interface HeaderHttpRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** 外部 HTTP client の差し替えポート。 */
export interface HeaderHttpClient {
  request(request: HeaderHttpRequest): Promise<HeaderHttpResponse>;
}

/** Native / Container の HTTP header 受入れ対象 profile。 */
export interface HeaderSecurityProfile {
  readonly name: "native" | "container";
  readonly httpsUrl?: string;
  readonly httpUrl?: string;
  readonly publicPath: string;
  readonly manifestPath: string;
  readonly adminPath: string;
  readonly apacheErrorPath: string;
  readonly tracePath: string;
  readonly clientErrorPath: string;
  readonly serverErrorUrl?: string;
}

/** 1 シナリオの raw status/header と正規化結果。 */
export interface HeaderSecurityResult {
  readonly profile: HeaderSecurityProfile["name"];
  readonly scenario: HeaderSecurityScenarioId;
  readonly result: HeaderSecurityResultClass;
  readonly observation: Readonly<Record<string, unknown>>;
  readonly detail?: string;
}

/** profile ごとに保存する HTTP header 受入れ artifact。 */
export interface HeaderSecurityReport {
  readonly reportVersion: "resolver-http-security-headers-0.1";
  readonly profile: HeaderSecurityProfile["name"];
  readonly generatedAt: string;
  readonly results: readonly HeaderSecurityResult[];
}
