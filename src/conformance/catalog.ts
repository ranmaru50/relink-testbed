// src/conformance/catalog.ts

import type { CatalogCase, ConformanceTarget, NormativeStrength } from "./types.js";

/** Frozen Resolver / Manifest Conformance Catalog 0.1 の実行メタデータ。 */
export const CONFORMANCE_CATALOG_VERSION = "0.1";

type CatalogSeed = readonly [string, ConformanceTarget, NormativeStrength, string];

const resolverCases: readonly CatalogSeed[] = [
  ["RES-001", "RESOLVER-SERVER", "MUST", "ACTIVE UUID resolves to the current HTTPS Description Location."],
  ["RES-002", "RESOLVER-SERVER", "MUST", "A changed Description Location is reflected by a fresh request."],
  ["RES-003", "RESOLVER-SERVER", "MUST", "An unknown UUID returns 404."],
  ["RES-004", "RESOLVER-SERVER", "MUST", "An unsafe stored Location is never emitted."],
  ["ID-001", "RESOLVER-SERVER", "MUST", "Lowercase UUID text is accepted."],
  ["ID-002", "RESOLVER-SERVER", "MUST", "Uppercase UUID text identifies the same UUID."],
  ["ID-003", "RESOLVER-SERVER", "MUST", "Mixed-case UUID text is accepted."],
  ["ID-004", "RESOLVER-SERVER", "MUST", "Malformed UUID text returns 400."],
  ["ID-005", "RESOLVER-SERVER", "MUST", "UUID version bits do not alter supported registered semantics."],
  ["HTTP-001", "RESOLVER-SERVER", "MUST", "Public GET is read-only."],
  ["HTTP-002", "RESOLVER-SERVER", "MUST", "Unsupported methods return 405 and Allow: GET."],
  ["HTTP-003", "RESOLVER-SERVER", "MUST", "Unsupported-method result is independent of registration state."],
  ["HTTP-004", "RESOLVER-SERVER", "MUST", "Unsupported l fails closed."],
  ["HTTP-005", "RESOLVER-SERVER", "MUST", "Reserved p without a defining level fails closed."],
  ["LIFE-001", "RESOLVER-SERVER", "MUST", "ACTIVE maps to 303."],
  ["LIFE-002", "RESOLVER-SERVER", "MUST", "SUSPENDED maps to 404."],
  ["LIFE-003", "RESOLVER-SERVER", "MUST", "RETIRED maps to 410."],
  ["LIFE-004", "LIFECYCLE-ADMIN", "MUST", "ACTIVE to SUSPENDED is permitted."],
  ["LIFE-005", "LIFECYCLE-ADMIN", "MUST", "SUSPENDED to ACTIVE is permitted."],
  ["LIFE-006", "LIFECYCLE-ADMIN", "MUST", "ACTIVE to RETIRED is permitted."],
  ["LIFE-007", "LIFECYCLE-ADMIN", "MUST", "SUSPENDED to RETIRED is permitted."],
  ["LIFE-008", "LIFECYCLE-ADMIN", "MUST", "RETIRED to ACTIVE is rejected."],
  ["LIFE-009", "LIFECYCLE-ADMIN", "MUST", "RETIRED to SUSPENDED is rejected."],
  ["LIFE-010", "LIFECYCLE-ADMIN", "MUST", "Lifecycle and Description Location remain independent."],
  ["LIFE-011", "REFERENCE-RESOLVER", "SHOULD", "Retained history has consistent state and transition time."],
  ["LIFE-012", "RESOLVER-SERVER", "MUST", "The origin reflects the committed lifecycle state."],
  ["CACHE-001", "RESOLVER-SERVER", "MUST", "ACTIVE 303 has an explicit cache policy."],
  ["CACHE-002", "REFERENCE-RESOLVER", "SHOULD", "ACTIVE responses default to public max-age 60."],
  ["CACHE-003", "REFERENCE-RESOLVER", "SHOULD", "Error responses use no-store."],
  ["CACHE-004", "RESOLVER-SERVER", "MAY", "410 may have a finite cache lifetime."],
  ["CORS-001", "RESOLVER-SERVER", "SHOULD", "Browser-oriented Core exposes permissive CORS."],
  ["MAN-001", "MANIFEST-PRODUCER", "MUST", "A minimal valid Manifest is produced."],
  ["MAN-005", "MANIFEST-ENDPOINT", "MUST", "Manifest anchor.id matches the UUID path."],
  ["MAN-006", "MANIFEST-PRODUCER", "MUST", "Entity identity remains stable when Location changes."],
  ["MAN-008", "MANIFEST-PRODUCER", "MUST", "L1 Description Location uses HTTPS."],
  ["MAN-009", "RESOLVER-SERVER", "MUST", "Manifest absence does not break Core L1."],
  ["MAN-010", "MANIFEST-ENDPOINT", "SHOULD", "ACTIVE Manifest returns 200 application/json."],
  ["MAN-011", "MANIFEST-ENDPOINT", "SHOULD", "SUSPENDED Manifest returns 404."],
  ["MAN-012", "MANIFEST-ENDPOINT", "SHOULD", "RETIRED Manifest returns 410."],
  ["MAN-013", "MANIFEST-ENDPOINT", "SHOULD", "Unknown Manifest UUID returns 404."],
  ["MAN-014", "MANIFEST-PRODUCER", "MUST", "A Manifest without integrity remains valid."],
  ["MAN-015", "MANIFEST-PRODUCER", "MUST", "sha-256 integrity has the required structure and syntax."],
  ["MNET-001", "MANIFEST-ENDPOINT", "MUST", "Manifest L1 retrieval uses HTTPS."],
  ["INT-002", "INTEGRITY-CONSUMER", "MUST", "A matching sha-256 digest verifies successfully."],
  ["INT-003", "INTEGRITY-CONSUMER", "MUST", "A digest mismatch is exposed as verification failure."],
  ["INT-004", "INTEGRITY-CONSUMER", "MUST", "An unsupported algorithm is never reported verified."],
  ["INT-006", "INTEGRITY-CONSUMER", "MUST", "A redirect body is not digest input."],
  ["INT-007", "INTEGRITY-CONSUMER", "MUST", "Digest input follows HTTP content-coding processing."],
  ["INT-008", "INTEGRITY-CONSUMER", "MUST", "Integrity success is not Trust."],
];

const consumerOnlyCases: readonly CatalogSeed[] = [
  ["REDIR-001", "L1-CONSUMER", "MAY", "An ordinary HTTPS redirect before Resolver may be followed."],
  ["REDIR-002", "L1-CONSUMER", "MAY", "The consumer follows Resolver 303 under network policy."],
  ["REDIR-003", "L1-CONSUMER", "MAY", "The Description Location may redirect over HTTPS."],
  ["REDIR-004", "L1-CONSUMER", "MUST", "An HTTPS to HTTP downgrade before Resolver fails."],
  ["REDIR-005", "L1-CONSUMER", "MUST", "An HTTPS to HTTP downgrade after Resolver fails."],
  ["REDIR-006", "L1-CONSUMER", "MUST", "The final AR-XML URL uses HTTPS."],
  ["REDIR-007", "L1-CONSUMER", "SHOULD", "Redirect traversal is bounded or loop-detected."],
  ["NET-001", "L1-CONSUMER", "MUST", "Resolver Location is treated as untrusted input."],
  ["NET-002", "MANIFEST-CONSUMER", "MUST", "Manifest Location is treated as untrusted input."],
  ["NET-003", "L1-CONSUMER", "MUST", "A configured denied destination is not fetched."],
  ["NET-004", "L1-CONSUMER", "SHOULD", "Redirect destinations are re-evaluated."],
  ["NET-005", "L1-CONSUMER", "MUST", "A successful Resolver response does not bypass policy."],
  ["CORS-002", "L1-CONSUMER", "MUST", "Resolver CORS does not grant AR-XML fetch permission."],
  ["MAN-002", "MANIFEST-CONSUMER", "MUST", "Unsupported Manifest versions are rejected."],
  ["MAN-003", "MANIFEST-CONSUMER", "MUST", "Strict JSON is required."],
  ["MAN-004", "MANIFEST-CONSUMER", "MUST", "Duplicate object members are rejected."],
  ["MAN-007", "MANIFEST-CONSUMER", "MUST", "Entity identity is not a dereference instruction."],
  ["MNET-002", "MANIFEST-CONSUMER", "MUST", "Manifest HTTPS to HTTP downgrade is rejected."],
  ["MNET-003", "MANIFEST-CONSUMER", "MUST", "Final Manifest representation uses an HTTPS-only chain."],
  ["EXT-001", "MANIFEST-CONSUMER", "SHOULD", "Unknown non-critical members remain processable."],
  ["EXT-002", "MANIFEST-CONSUMER", "SHOULD", "Unknown vendor extensions are ignored."],
  ["EXT-003", "MANIFEST-CONSUMER", "MUST", "Extensions cannot override description.location."],
  ["EXT-004", "MANIFEST-CONSUMER", "MUST", "Extensions cannot override lifecycle.status."],
  ["EXT-005", "MANIFEST-CONSUMER", "MUST", "Extensions cannot redefine integrity semantics."],
  ["EXT-006", "MANIFEST-CONSUMER", "MUST", "Trust-like names do not acquire Trust semantics."],
  ["EXT-007", "MANIFEST-CONSUMER", "MUST", "Vendor extensions are not a baseline dependency."],
  ["LIMIT-001", "MANIFEST-CONSUMER", "MAY", "A documented finite body-size limit may reject oversized input."],
  ["LIMIT-002", "MANIFEST-CONSUMER", "SHOULD", "A finite JSON nesting-depth limit is enforced."],
  ["LIMIT-003", "MANIFEST-CONSUMER", "SHOULD", "Finite member, element, time, and memory limits exist."],
  ["SCHEMA-001", "MANIFEST-CONSUMER", "MUST", "Semantic validation supplements JSON Schema validation."],
  ["SCHEMA-002", "MANIFEST-CONSUMER", "MUST", "UUID and absolute-URI semantics are checked explicitly."],
];

/** カタログ ID を削除・改名せずに保持する、実行順序付きのケース一覧。 */
export const conformanceCatalog: readonly CatalogCase[] = [...resolverCases, ...consumerOnlyCases].map(([id, target, strength, description]) => ({ id, target, strength, description }));

export function findCatalogCase(caseId: string): CatalogCase {
  const testCase = conformanceCatalog.find(candidate => candidate.id === caseId);
  if (testCase === undefined) throw new Error(`Unknown conformance case: ${caseId}`);
  return testCase;
}
