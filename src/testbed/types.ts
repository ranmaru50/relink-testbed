// src/testbed/types.ts

/** Immutable diagnostic data for a received HTTP request. */
export interface RecordedRequest {
  readonly method: string;
  readonly pathname: string;
  readonly query: Readonly<Record<string, string[]>>;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: Uint8Array;
  readonly text: string;
  readonly timestamp: number;
  readonly endpointId: string;
  readonly json?: unknown;
}

/** Runtime-independent case definition. */
export interface TestCaseDefinition {
  readonly id: string;
  readonly group: string;
  readonly description: string;
  readonly document?: string;
  readonly capabilityId?: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly expected?: unknown;
}

/** Case information resolved against a running origin. */
export interface TestCase extends TestCaseDefinition {
  readonly documentUrl?: string;
}

/** Public API for instance-local request history. */
export interface RequestHistory {
  all(endpointId?: string): readonly RecordedRequest[];
  last(endpointId?: string): RecordedRequest | undefined;
  reset(): void;
}
