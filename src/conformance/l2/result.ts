// src/conformance/l2/result.ts
// Verifier verdict vocabulary (§15.2) and ConformanceReport helpers for L2 catalog cases.

import type { ConformanceResult, ConformanceResultClass, ConformanceTarget, CatalogCase } from "../types.js";

export type VerifierVerdict =
  | "VERIFIED"
  | "UNVERIFIED"
  | "INVALID"
  | "EXPIRED"
  | "REVOKED"
  | "STALE"
  | "UNKNOWN_AUTHORITY"
  | "UNSUPPORTED_ALGORITHM"
  | "CONFLICT"
  | "MISMATCH"
  | "ANCHOR_MISMATCH";

export const ALL_VERIFIER_VERDICTS: VerifierVerdict[] = [
  "VERIFIED",
  "UNVERIFIED",
  "INVALID",
  "EXPIRED",
  "REVOKED",
  "STALE",
  "UNKNOWN_AUTHORITY",
  "UNSUPPORTED_ALGORITHM",
  "CONFLICT",
  "MISMATCH",
  "ANCHOR_MISMATCH"
];

export interface VerifierOutcome {
  verdict: VerifierVerdict;
  phase: number;
  detail: string;
}

export interface CaseOutcome {
  result: ConformanceResultClass;
  observation: Record<string, unknown>;
  detail?: string;
}

export interface ReportContext {
  catalogVersion: string;
  profile: string;
  resolverCommit: string;
}

export function matchVerdict(expected: VerifierVerdict, outcome: VerifierOutcome): CaseOutcome {
  if (outcome.verdict === expected) {
    return {
      result: "PASS",
      observation: { expected, observed: outcome.verdict, phase: outcome.phase },
      detail: outcome.detail
    };
  }
  return {
    result: "FAIL",
    observation: { expected, observed: outcome.verdict, phase: outcome.phase },
    detail: outcome.detail
  };
}

export function buildConformanceResult(
  caseItem: CatalogCase,
  target: ConformanceTarget,
  context: ReportContext,
  outcome: CaseOutcome
): ConformanceResult {
  return {
    catalogVersion: context.catalogVersion,
    profile: context.profile,
    resolverCommit: context.resolverCommit,
    target,
    caseId: caseItem.id,
    strength: caseItem.strength,
    result: outcome.result,
    observation: outcome.observation,
    detail: outcome.detail
  };
}
