// src/conformance/types.ts

/** Resolver / Manifest 適合性 runner が共有する型と結果契約を定義するパッケージ。 */

export const CONFORMANCE_RESULT_CLASSES = [
  "PASS",
  "FAIL",
  "PASS-WITH-DEVIATION",
  "NOT-APPLICABLE",
  "UNSUPPORTED-OPTIONAL"
] as const;

export type ConformanceResultClass = typeof CONFORMANCE_RESULT_CLASSES[number];

export type ConformanceTarget =
  | "RESOLVER-SERVER"
  | "L1-CONSUMER"
  | "MANIFEST-ENDPOINT"
  | "MANIFEST-PRODUCER"
  | "MANIFEST-CONSUMER"
  | "INTEGRITY-CONSUMER"
  | "LIFECYCLE-ADMIN"
  | "REFERENCE-RESOLVER";

export type NormativeStrength = "MUST" | "SHOULD" | "MAY";

export interface CatalogCase {
  readonly id: string;
  readonly targets: readonly ConformanceTarget[];
  readonly strength: NormativeStrength;
  readonly description: string;
}

/** 実行対象の Resolver profile。Native と Container は同じ契約で扱う。 */
export interface ResolverProfile {
  readonly name: string;
  readonly baseUrl: string;
  readonly adminUrl?: string;
  readonly adminUsername: string;
  readonly adminPassword: string;
  readonly servicePath?: string;
  readonly resolverCommit: string;
  readonly catalogVersion?: string;
}

export interface HttpResponseSnapshot {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface HttpRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly redirect?: "error" | "follow" | "manual";
}

export interface ConformanceHttpClient {
  request(request: HttpRequest): Promise<HttpResponseSnapshot>;
}

export interface ConformanceResult {
  readonly catalogVersion: string;
  readonly profile: string;
  readonly resolverCommit: string;
  readonly target: ConformanceTarget;
  readonly caseId: string;
  readonly strength: NormativeStrength;
  readonly result: ConformanceResultClass;
  readonly observation: Readonly<Record<string, unknown>>;
  readonly detail?: string;
}

export interface ConformanceReport {
  readonly catalogVersion: string;
  readonly profile: string;
  readonly resolverCommit: string;
  readonly generatedAt: string;
  readonly results: readonly ConformanceResult[];
}

export interface FetchHttpClientOptions {
  readonly fetcher?: typeof fetch;
}
