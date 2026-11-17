// tests/conformance/l2-coverage.ts
// Coverage map for the L2 catalog: case id -> vitest test titles that assert it. Every one of
// the 91 catalog case ids must appear here, and the suites below build their it() titles from
// this map, so a test title always names the catalog case id it covers.

import { L2_CONFORMANCE_CASES, l2CatalogIds } from "../../src/conformance/l2/catalog.js";

export interface L2CaseTitle {
  readonly caseId: string;
  readonly title: string;
}

export const L2_VER_TITLES: L2CaseTitle[] = [
  { caseId: "L2-VER-001", title: "valid statement with a complete accepted chain verifies at T" },
  { caseId: "L2-VER-002", title: "key material failing keyId recomputation is outside the accepted chain" },
  { caseId: "L2-VER-003", title: "wire-level failures (duplicate members, non-integer, l2Version, signature-in-payload, keyId recompute) fail closed at phase 1" },
  { caseId: "L2-VER-004", title: "anchorId mismatch is ANCHOR_MISMATCH at phase 2" },
  { caseId: "L2-VER-005", title: "unknown algorithm is UNSUPPORTED_ALGORITHM at phase 3" },
  { caseId: "L2-VER-006", title: "untrusted clock is UNVERIFIED at phase 4" },
  { caseId: "L2-VER-007", title: "chain contiguity gap is UNVERIFIED at phase 5" },
  { caseId: "L2-VER-008", title: "statement signed by a key absent from the complete chain is UNKNOWN_AUTHORITY" },
  { caseId: "L2-VER-009", title: "Record 0 requires policy-channel provenance as the chain anchor" },
  { caseId: "L2-VER-010", title: "Record 1 rotation with the key1 retirement cap is accepted" },
  { caseId: "L2-VER-011", title: "Record 2 trail epoch switch to epoch-1 is accepted with floor 0" },
  { caseId: "L2-VER-012", title: "Record 3 is accepted and its snapshot is fresh at T" },
  { caseId: "L2-VER-013", title: "snapshot selection is independent of statement freshness" },
  { caseId: "L2-VER-014", title: "chain walk boundaries: record wire duplicate, trail failure, absent signer, material gap, snapshot gap" },
  { caseId: "L2-VER-015", title: "statement in a never-accepted epoch is STALE at phase 10" },
  { caseId: "L2-VER-016", title: "Record 5 is rejected by trail matching, not by a signature failure" },
  { caseId: "L2-VER-017", title: "Record 6 contiguity gap stops the walk; epochs 2 and 3 are never accepted" },
  { caseId: "L2-VER-018", title: "statement verifies on the effective prefix when a later Record is excluded at T" },
  { caseId: "L2-VER-019", title: "no fresh snapshot at keypoint T'; back-off to a stale Record is prohibited" },
  { caseId: "L2-VER-020", title: "expired snapshot at T is UNVERIFIED at phase 6" },
  { caseId: "L2-VER-021", title: "snapshot freshness boundary equality passes at phase 6" },
  { caseId: "L2-VER-022", title: "revocation snapshot at T covers gens 0..5; the above-floor statement verifies" },
  { caseId: "L2-VER-023", title: "lower-position and byte-identical replay presentations keep the freshness point" },
  { caseId: "L2-VER-024", title: "statement freshness skew cannot manufacture snapshot freshness" },
  { caseId: "L2-VER-025", title: "statement in a prior epoch is STALE; phase 9 is skipped" },
  { caseId: "L2-VER-026", title: "statement issued at the revocation Record time is REVOKED at phase 9" },
  { caseId: "L2-VER-027", title: "byte-identical statement replay verifies with no penalty" },
  { caseId: "L2-VER-028", title: "statement equivocation at the same generation is CONFLICT" },
  { caseId: "L2-VER-029", title: "Record replay, byte-identical, and same-generation conflict presentation rules" },
  { caseId: "L2-VER-030", title: "statement generation at or below the floor is STALE" },
  { caseId: "L2-VER-031", title: "statement window ending before T is EXPIRED" },
  { caseId: "L2-VER-032", title: "re-evaluation after the snapshot window is UNVERIFIED" },
  { caseId: "L2-VER-033", title: "fresh snapshot covers epoch, keys, and floor; the prior-epoch statement is STALE" },
  { caseId: "L2-VER-034", title: "retired signing key in the accepted epoch is UNVERIFIED, never REVOKED" },
  { caseId: "L2-VER-035", title: "statement signed by a revoked key is REVOKED" },
  { caseId: "L2-VER-036", title: "re-registering a revoked key is rejected; the revocation verdict stays" },
  { caseId: "L2-VER-037", title: "revokedFrom mutation is rejected; the revocation verdict is unchanged" },
  { caseId: "L2-VER-038", title: "l1-bound verification with a matching L1 observation is VERIFIED" },
  { caseId: "L2-VER-039", title: "l1-bound observed location mismatch is MISMATCH at phase 11" },
  { caseId: "L2-VER-040", title: "missing L1 observation is UNVERIFIED; statement-only mode makes no L1 request" },
  { caseId: "L2-VER-041", title: "verdicts are the eleven states, not booleans" },
  { caseId: "L2-VER-042", title: "phase order is fixed; the first failing phase wins on multi-failure inputs" },
  { caseId: "L2-VER-043", title: "fail-closed: empty material, absent signer, cached revocation evidence" },
  { caseId: "L2-VER-044", title: "snapshot failure is UNVERIFIED, never reported as REVOKED" },
  { caseId: "L2-VER-045", title: "statement revocation is optional in the baseline report" },
  { caseId: "L2-VER-046", title: "canonical bytes, outer whitespace tolerance, duplicate detection on raw text" },
  { caseId: "L2-VER-047", title: "S9 floor, stale variant, equivocation, and byte-identical replay subcases" }
];

export const L2_PRO_TITLES: L2CaseTitle[] = [
  { caseId: "L2-PRO-001", title: "a single JCS canonical signing target, payload bytes verbatim in the wire" },
  { caseId: "L2-PRO-002", title: "A2-Vector1 reproduced byte-identical with the pinned signature verifying" },
  { caseId: "L2-PRO-003", title: "extension keys are sorted by UTF-16 code units (A3-Vector2)" },
  { caseId: "L2-PRO-004", title: "non-BMP keys are ordered by UTF-16 code units (A4-Vector3)" },
  { caseId: "L2-PRO-005", title: "the Trail 2 canonical payload appears verbatim inside Record 2" },
  { caseId: "L2-PRO-006", title: "producers never emit duplicate members; duplicate wires are rejected" },
  { caseId: "L2-PRO-007", title: "the signature lives only in the envelope, never inside the payload" },
  { caseId: "L2-PRO-008", title: "keyId is base64url of the first 8 SHA-256 bytes of the raw public key" },
  { caseId: "L2-PRO-009", title: "a single permanent key never satisfies the baseline key lifecycle" },
  { caseId: "L2-PRO-010", title: "the Vector 3b escape fixture is byte-identical with a consistent digest" },
  { caseId: "L2-PRO-011", title: "every pinned signature verifies over its canonical payload bytes" },
  { caseId: "L2-PRO-012", title: "ES256 support is optional in the baseline" }
];

export const L2_SRV_TITLES: L2CaseTitle[] = [
  { caseId: "L2-SRV-001", title: "the statement surface is additive to Core with the §6.1 status table" },
  { caseId: "L2-SRV-002", title: "the authority material body is the contiguous ascending Records 0..G" },
  { caseId: "L2-SRV-003", title: "GET-only read-only anonymous public surface with 405 + Allow: GET" },
  { caseId: "L2-SRV-004", title: "query contract: p with l=2 and unsupported l values fail closed at 400" },
  { caseId: "L2-SRV-005", title: "cache policy bounded by remaining validity; cache reuse is not currency" },
  { caseId: "L2-SRV-006", title: "Referrer-Policy: no-referrer SHOULD is honored by the reference stub" },
  { caseId: "L2-SRV-007", title: "privacy: minimized Anchor UUID metadata, no cookies, no parameter expansion" },
  { caseId: "L2-SRV-008", title: "Reference Resolver boundary: no AR-XML processing, no public mutations" }
];

/** L2-AUT titles come from the catalog description title segment (before " — "). */
export const L2_AUT_TITLES: L2CaseTitle[] = L2_CONFORMANCE_CASES
  .filter(caseItem => caseItem.id.startsWith("L2-AUT-"))
  .map(caseItem => ({ caseId: caseItem.id, title: caseItem.description.split(" — ")[0] ?? caseItem.id }));

/** Extra vitest titles that also assert catalog cases (fixtures self-consistency, deviations). */
export const L2_EXTRA_TITLES: [string, string][] = [
  ["L2-PRO-002", "L2-PRO-002, L2-VER-046 — every pinned payload string is JCS-canonical and reproducible"],
  ["L2-VER-046", "L2-PRO-002, L2-VER-046 — every pinned payload string is JCS-canonical and reproducible"],
  ["L2-VER-046", "L2-VER-046 — wire envelopes carry the pinned payload bytes verbatim"],
  ["L2-PRO-008", "L2-PRO-008 — keyId recomputes from publicKey for every fixture key"],
  ["L2-PRO-002", "L2-PRO-002 — the PKCS#8 seed prefix reproduces the pinned key1 material and signature"],
  ["L2-PRO-010", "L2-PRO-010 — the escape fixture is canonical and its digest relation is consistent"],
  ["L2-PRO-011", "L2-PRO-011 — every pinned signature verifies over its canonical payload bytes"],
  ["L2-VER-047", "L2-VER-047 — the S9 variants have the pinned byte lengths 364 / 364 / 366"],
  ["L2-SRV-006", "L2-SRV-006 — a documented Referrer-Policy deviation is recorded as PASS-WITH-DEVIATION"]
];

/** caseId -> vitest test titles covering it; the coverage test asserts this map is complete. */
export const L2_COVERAGE: Record<string, string[]> = (() => {
  const coverage: Record<string, string[]> = {};
  for (const { caseId, title } of [...L2_VER_TITLES, ...L2_AUT_TITLES, ...L2_PRO_TITLES, ...L2_SRV_TITLES]) {
    coverage[caseId] = [`${caseId} — ${title}`];
  }
  for (const [caseId, name] of L2_EXTRA_TITLES) {
    coverage[caseId] = [...(coverage[caseId] ?? []), name];
  }
  return coverage;
})();

/** Catalog ids not present in the coverage map. */
export function l2UncoveredIds(): string[] {
  return l2CatalogIds().filter(caseId => coverageHas(coverageSnapshot(), caseId).length === 0);
}

function coverageSnapshot(): Record<string, string[]> {
  return L2_COVERAGE;
}

function coverageHas(coverage: Record<string, string[]>, caseId: string): string[] {
  return coverage[caseId] ?? [];
}

/** Coverage map ids that are not in the catalog (must be empty). */
export function l2UnknownIds(): string[] {
  const known = new Set(l2CatalogIds());
  return Object.keys(L2_COVERAGE).filter(caseId => !known.has(caseId));
}
