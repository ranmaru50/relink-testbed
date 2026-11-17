// src/conformance/l2/verifier.ts
// L2 0.1 statement verifier following §15.2 phases 1-11, plus §9.7 anti-rollback
// statement position rules and §14/§7.4 l1-bound checks.

import { parseWireEnvelope, WireError } from "./wire.js";
import { validateStatementPayload, type KeyEntry, type StatementPayload } from "./model.js";
import { verifyEd25519 } from "./ed25519.js";
import { keyIdMatches } from "./keyId.js";
import { walkChain, findKey, type ChainWalkResult, type TrustAnchorBinding } from "./chainWalk.js";
import type { VerifierOutcome, VerifierVerdict } from "./result.js";

const SUPPORTED_ALGORITHMS = new Set(["ed25519"]);

export interface VerifierState {
  anchor: TrustAnchorBinding;
  T: number;
  W: number;
  clockTrusted: boolean;
  mode: "statement-only" | "l1-bound";
}

export interface StatementLedger {
  epochMax: Map<string, number>;
  epochPayloads: Map<string, Set<string>>;
}

export function createStatementLedger(anchor: TrustAnchorBinding): StatementLedger {
  return {
    epochMax: new Map([[anchor.epochId, anchor.statementFloor]]),
    epochPayloads: new Map()
  };
}

export function commitVerifiedStatement(ledger: StatementLedger, payload: StatementPayload, payloadWireText: string): void {
  const epoch = payload["epochId"] as string;
  const generation = payload["generation"] as number;
  const currentMax = ledger.epochMax.get(epoch) ?? -1;
  if (generation > currentMax) {
    ledger.epochMax.set(epoch, generation);
  }
  const payloads = ledger.epochPayloads.get(epoch) ?? new Set<string>();
  payloads.add(payloadWireText);
  ledger.epochPayloads.set(epoch, payloads);
}

export interface ParsedStatement {
  payload: StatementPayload;
  payloadWireText: string;
  signature: string;
}

export function parseStatementWire(wire: string): { parsed?: ParsedStatement; failures: string[] } {
  let envelope;
  try {
    envelope = parseWireEnvelope(wire);
  } catch (error) {
    return { failures: [`wire:${error instanceof WireError ? error.reason : "wire-parse-failure"}`] };
  }
  const payload = envelope.payload;
  const failures = validateStatementPayload(payload);
  if (payload["publicKey"] !== undefined) {
    const keyId = payload["keyId"];
    const publicKey = payload["publicKey"];
    if (typeof keyId === "string" && typeof publicKey === "string" && !keyIdMatches(keyId, publicKey)) {
      failures.push("keyid-recompute-mismatch");
    }
  }
  if (failures.length > 0) {
    return { failures };
  }
  return {
    parsed: {
      payload: payload as unknown as StatementPayload,
      payloadWireText: envelope.payloadWireText,
      signature: envelope.signature
    },
    failures: []
  };
}

export interface VerifyStatementInput {
  wire: string;
  recordWires: string[];
  policyChannelProvenance: boolean;
  state: VerifierState;
  ledger: StatementLedger;
  l1Observation?: { descriptionLocation: string };
}

export function verifyStatement(input: VerifyStatementInput): VerifierOutcome {
  const { wire, recordWires, policyChannelProvenance, state, ledger } = input;

  // Phase 1: wire canonicality, strict parse, duplicate members, integer range, l2Version.
  const statement = parseStatementWire(wire);
  if (statement.parsed === undefined) {
    return { verdict: "INVALID", phase: 1, detail: statement.failures.join(",") };
  }
  const payload = statement.parsed.payload;
  const payloadWireText = statement.parsed.payloadWireText;

  // Phase 2: anchorId match against the pinned Trust Anchor Binding.
  if (payload["anchorId"] !== state.anchor.anchorId) {
    return { verdict: "ANCHOR_MISMATCH", phase: 2, detail: "anchorId does not match the Trust Anchor Binding" };
  }

  // Phase 3: algorithm known and supported by this verifier.
  const algorithm = payload["algorithm"] as string;
  if (!SUPPORTED_ALGORITHMS.has(algorithm)) {
    return { verdict: "UNSUPPORTED_ALGORITHM", phase: 3, detail: `algorithm ${algorithm} is not supported by the baseline verifier` };
  }

  // Phase 4: a trusted clock value for T is available.
  if (!state.clockTrusted) {
    return { verdict: "UNVERIFIED", phase: 4, detail: "no trusted clock value for T" };
  }

  // Phase 5: chain walk over the presented Records.
  const chain = walkChain({
    anchor: state.anchor,
    recordWires,
    policyChannelProvenance
  });
  if (chain.stop !== null) {
    // A key material that fails recomputation is provably outside the accepted chain, so the
    // statement signer resolves as UNKNOWN_AUTHORITY, never as INVALID on the statement (§9.4).
    if (chain.stop.verdict === "UNKNOWN_AUTHORITY" || chain.stop.reason.includes("keyid-recompute-mismatch")) {
      return { verdict: "UNKNOWN_AUTHORITY", phase: 5, detail: `chain stopped: ${chain.stop.reason}` };
    }
    if (chain.stop.verdict === "CONFLICT") {
      return { verdict: "CONFLICT", phase: 5, detail: `chain stopped: ${chain.stop.reason}` };
    }
    return { verdict: "UNVERIFIED", phase: 5, detail: `chain stopped: ${chain.stop.reason}` };
  }

  if (chain.accepted.length === 0) {
    return { verdict: "UNVERIFIED", phase: 5, detail: "no accepted Record material provides a trusted lower bound" };
  }

  const signerEntry = findSignerKey(chain, payload["keyId"] as string);
  if (signerEntry === undefined) {
    if (chain.stop === null) {
      return { verdict: "UNKNOWN_AUTHORITY", phase: 5, detail: "signer keyId is not present in the accepted chain" };
    }
    return { verdict: "UNVERIFIED", phase: 5, detail: "signer key is not reachable through the accepted material" };
  }

  // Phase 6: revocation snapshot = last Record of the effective prefix at T.
  const prefix = chain.accepted.filter(record => (record.payload["issuedAt"] as number) <= state.T);
  if (prefix.length === 0) {
    return { verdict: "UNVERIFIED", phase: 6, detail: "no accepted Record lower bound at T" };
  }
  const snapshot = prefix[prefix.length - 1];
  if (snapshot === undefined) {
    return { verdict: "UNVERIFIED", phase: 6, detail: "no accepted Record lower bound at T" };
  }
  const snapshotIssuedAt = snapshot.payload["issuedAt"] as number;
  const snapshotExpiresAt = snapshot.payload["expiresAt"] as number;
  if (state.T > snapshotExpiresAt) {
    return { verdict: "UNVERIFIED", phase: 6, detail: "snapshot Record expired at T" };
  }
  if (state.T - snapshotIssuedAt > state.W) {
    return { verdict: "UNVERIFIED", phase: 6, detail: "snapshot Record older than the freshness window W" };
  }
  const snapshotKeys = snapshot.payload["keys"] as KeyEntry[];
  const snapshotSigner = findKey(snapshotKeys, payload["keyId"] as string);
  if (snapshotSigner === undefined) {
    return { verdict: "UNVERIFIED", phase: 6, detail: "snapshot does not cover the signing key" };
  }
  const acceptedEpoch = chain.acceptedEpoch;

  // Phase 8: signature verification over the canonical payload bytes.
  if (payload["algorithm"] !== snapshotSigner.algorithm) {
    return { verdict: "INVALID", phase: 8, detail: "statement algorithm does not match the signing key entry algorithm" };
  }
  if (!verifyEd25519(snapshotSigner.publicKey, statement.parsed.signature, payloadWireText)) {
    return { verdict: "INVALID", phase: 8, detail: "signature does not verify under the signing key" };
  }

  // Phase 9: key state, evaluated only when the statement epoch is the accepted epoch.
  if (payload["epochId"] === acceptedEpoch) {
    if (payload["entityId"] !== state.anchor.entityId) {
      return { verdict: "UNKNOWN_AUTHORITY", phase: 9, detail: "entityId does not match the Trust Anchor Binding" };
    }
    const issuedAt = payload["issuedAt"] as number;
    if (issuedAt < snapshotSigner.validFrom || issuedAt > snapshotSigner.validUntil) {
      return { verdict: "UNVERIFIED", phase: 9, detail: "statement issuedAt is outside the signing key validity window" };
    }
    if (snapshotSigner.status === "retired") {
      return { verdict: "UNVERIFIED", phase: 9, detail: "signing key is retired" };
    }
    if (snapshotSigner.status === "revoked" || snapshotSigner.status === "compromised") {
      const revocation = chain.accepted.find(record => record.payload["recordGeneration"] === snapshotSigner.revokedFrom);
      if (revocation !== undefined && issuedAt >= (revocation.payload["issuedAt"] as number)) {
        return { verdict: "REVOKED", phase: 9, detail: `signing key revoked at Record generation ${String(snapshotSigner.revokedFrom)}` };
      }
      // Statement issued before the revocation Record: §11.3 anti-rollback applies in phase 10.
    }
  }

  // Phase 10: statement freshness and anti-rollback position.
  const issuedAt = payload["issuedAt"] as number;
  const expiresAt = payload["expiresAt"] as number;
  if (state.T < issuedAt || state.T > expiresAt) {
    return { verdict: "EXPIRED", phase: 10, detail: "statement time window does not contain T" };
  }
  const epoch = payload["epochId"] as string;
  if (epoch !== acceptedEpoch) {
    return { verdict: "STALE", phase: 10, detail: `statement epoch ${epoch} is not the accepted epoch` };
  }
  const floor = snapshot.payload["statementFloor"] as number;
  const generation = payload["generation"] as number;
  if (generation <= floor) {
    return { verdict: "STALE", phase: 10, detail: "statement generation is at or below the epoch statement floor" };
  }
  const epochMax = ledger.epochMax.get(epoch) ?? floor;
  if (generation < epochMax) {
    return { verdict: "STALE", phase: 10, detail: "statement generation is below the accepted statement maximum" };
  }
  if (generation === epochMax) {
    const acceptedPayloads = ledger.epochPayloads.get(epoch) ?? new Set<string>();
    if (!acceptedPayloads.has(payloadWireText)) {
      return { verdict: "CONFLICT", phase: 10, detail: "same statement generation with a different payload (equivocation)" };
    }
    // Byte-identical replay at the accepted maximum: no penalty, keep evaluating.
  }

  // Phase 11: l1-bound §7.4 evidence.
  if (state.mode === "l1-bound") {
    const observation = input.l1Observation;
    if (observation === undefined) {
      return { verdict: "UNVERIFIED", phase: 11, detail: "no L1 observation for an l1-bound verification" };
    }
    if (observation.descriptionLocation !== payload["descriptionLocation"]) {
      return { verdict: "MISMATCH", phase: 11, detail: "L1 observed location differs from the statement descriptionLocation" };
    }
  }

  return { verdict: "VERIFIED", phase: 11, detail: "all phases passed" };
}

function findSignerKey(chain: ChainWalkResult, keyId: string): KeyEntry | undefined {
  for (const record of chain.accepted) {
    const entry = findKey(record.payload["keys"] as KeyEntry[], keyId);
    if (entry !== undefined) {
      return entry;
    }
  }
  return undefined;
}

export type { VerifierVerdict };
