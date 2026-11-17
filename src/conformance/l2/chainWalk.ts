// src/conformance/l2/chainWalk.ts
// §9.6 Record chain acceptance: Trust Anchor binding for Record 0, contiguous generations,
// prevRecordDigest = lowercase hex SHA-256 over the JCS canonical payload member of the
// accepted Record G-1, non-decreasing issuedAt, signerKeyId current in G-1 with a window
// containing issuedAt(G), transfer trail matching per §12.2, §9.5 key mutation rules.

import { jcsCanonicalize } from "./jcs.js";
import { parseWireEnvelope, WireError, type WireEnvelope } from "./wire.js";
import { keyIdMatches, sha256HexOfUtf8 } from "./keyId.js";
import { verifyEd25519 } from "./ed25519.js";
import { validateRecordPayload, validateTrailPayload, type KeyEntry, type RecordPayload, type TransferEnvelope } from "./model.js";
import { validateKeyMutation, findTransferIncoming } from "./keyMutation.js";

export interface TrustAnchorBinding {
  anchorId: string;
  entityId: string;
  keyId: string;
  publicKey: string;
  algorithm: string;
  epochId: string;
  statementFloor: number;
}

export interface ParsedRecord {
  wire: string;
  payloadWireText: string;
  payload: RecordPayload;
  signature: string;
}

export type RecordEvaluationVerdict =
  | "ACCEPTED"
  | "REPLAY"
  | "INVALID"
  | "STALE"
  | "CONFLICT"
  | "UNVERIFIED"
  | "UNKNOWN_AUTHORITY";

export interface RecordEvaluation {
  wire: string;
  record?: ParsedRecord;
  accepted: boolean;
  verdict: RecordEvaluationVerdict;
  phase: number;
  reason: string;
}

export interface ChainWalkResult {
  accepted: ParsedRecord[];
  acceptedMax: number;
  acceptedEpoch: string;
  statementFloor: number;
  acceptedEpochs: string[];
  evaluations: RecordEvaluation[];
  stop: RecordEvaluation | null;
}

export interface WalkChainOptions {
  anchor: TrustAnchorBinding;
  recordWires: string[];
  /** Record 0 is accepted only when provenance arrives over the policy channel (§15.1). */
  policyChannelProvenance: boolean;
}

export function parseRecordWire(wire: string): { parsed?: ParsedRecord; failures: string[] } {
  let envelope: WireEnvelope;
  try {
    envelope = parseWireEnvelope(wire);
  } catch (error) {
    const reason = error instanceof WireError ? error.reason : "wire-parse-failure";
    return { failures: [`wire:${reason}`] };
  }
  const payload = envelope.payload;
  const failures = validateRecordPayload(payload);
  const keys = payload["keys"];
  if (Array.isArray(keys)) {
    for (const entry of keys) {
      const e = entry as Record<string, unknown>;
      const keyId = e["keyId"];
      const publicKey = e["publicKey"];
      if (typeof keyId === "string" && typeof publicKey === "string" && !keyIdMatches(keyId, publicKey)) {
        failures.push("keyid-recompute-mismatch");
      }
    }
  }
  if (failures.length > 0) {
    return { failures };
  }
  const parsedPayload = payload as unknown as RecordPayload;
  const transferWire = payload["transfer"];
  if (transferWire !== undefined) {
    const transferFailures = validateTransferEnvelope(transferWire);
    if (transferFailures.length > 0) {
      return { failures: transferFailures };
    }
    parsedPayload.transfer = transferWire as unknown as TransferEnvelope;
  }
  return {
    parsed: {
      wire,
      payloadWireText: envelope.payloadWireText,
      payload: parsedPayload,
      signature: envelope.signature
    },
    failures: []
  };
}

function validateTransferEnvelope(transferWire: unknown): string[] {
  if (transferWire === null || typeof transferWire !== "object" || Array.isArray(transferWire)) {
    return ["transfer-not-object"];
  }
  const transfer = transferWire as Record<string, unknown>;
  const payload = transfer["payload"];
  const signature = transfer["signature"];
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return ["transfer-payload-not-object"];
  }
  if (typeof signature !== "string") {
    return ["transfer-signature-not-string"];
  }
  const failures = validateTrailPayload(payload as Record<string, never>);
  if (jcsCanonicalize(payload) !== JSON.stringify(payload)) {
    // The trail payload serialization must be canonical; in canonical Record text this is
    // guaranteed, so only explicitly embedded non-canonical trail objects fail here.
    failures.push("trail-payload-not-canonical");
  }
  return failures;
}

export function recordDigest(record: ParsedRecord): string {
  return sha256HexOfUtf8(record.payloadWireText);
}

export function walkChain(options: WalkChainOptions): ChainWalkResult {
  const accepted: ParsedRecord[] = [];
  const evaluations: RecordEvaluation[] = [];
  const acceptedEpochs: string[] = [options.anchor.epochId];
  let stop: RecordEvaluation | null = null;

  for (const wire of options.recordWires) {
    const evaluation = evaluateRecord(wire, accepted, options.anchor, options.policyChannelProvenance, acceptedEpochs);
    evaluations.push(evaluation);
    if (evaluation.accepted && evaluation.record !== undefined) {
      accepted.push(evaluation.record);
      if (evaluation.record.payload["epochId"] !== acceptedEpochs[acceptedEpochs.length - 1]) {
        acceptedEpochs.push(evaluation.record.payload["epochId"] as string);
      }
      continue;
    }
    if (evaluation.verdict === "REPLAY" || evaluation.verdict === "STALE") {
      // A lower-position presentation or a byte-identical replay does not advance the chain,
      // and does not break it (§11.3 anti-rollback presentation rules).
      continue;
    }
    stop = evaluation;
    break;
  }

  const last = accepted[accepted.length - 1];
  return {
    accepted,
    acceptedMax: last === undefined ? 0 : last.payload["recordGeneration"],
    acceptedEpoch: last === undefined ? options.anchor.epochId : (last.payload["epochId"] as string),
    statementFloor: last === undefined ? options.anchor.statementFloor : (last.payload["statementFloor"] as number),
    acceptedEpochs,
    evaluations,
    stop
  };
}

function evaluateRecord(
  wire: string,
  accepted: ParsedRecord[],
  anchor: TrustAnchorBinding,
  policyChannelProvenance: boolean,
  acceptedEpochs: string[]
): RecordEvaluation {
  const { parsed, failures } = parseRecordWire(wire);
  if (parsed === undefined) {
    return { wire, accepted: false, verdict: "INVALID", phase: 1, reason: failures.join(",") };
  }
  const payload = parsed.payload;
  const generation = payload["recordGeneration"] as number;

  if (accepted.length === 0) {
    if (generation !== 0) {
      return { wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "chain-below-anchor" };
    }
    return evaluateRecordZero(parsed, anchor, policyChannelProvenance);
  }

  const prev = accepted[accepted.length - 1];
  if (prev === undefined) {
    return { wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "chain-below-anchor" };
  }
  const prevGeneration = prev.payload["recordGeneration"] as number;

  if (generation < prevGeneration) {
    return { wire, record: parsed, accepted: false, verdict: "STALE", phase: 5, reason: "record-below-accepted-max" };
  }
  if (generation === prevGeneration) {
    if (parsed.payloadWireText === prev.payloadWireText) {
      return { wire, record: parsed, accepted: false, verdict: "REPLAY", phase: 5, reason: "byte-identical-replay" };
    }
    return { wire, record: parsed, accepted: false, verdict: "CONFLICT", phase: 5, reason: "same-generation-different-payload" };
  }
  if (generation > prevGeneration + 1) {
    return { wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "contiguity-gap" };
  }

  const payloadPrevDigest = payload["prevRecordDigest"];
  if (payloadPrevDigest !== recordDigest(prev)) {
    return { wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "prev-record-digest-mismatch" };
  }
  if ((payload["issuedAt"] as number) < (prev.payload["issuedAt"] as number)) {
    return { wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "issuedAt-decreasing" };
  }

  const signerKeyId = payload["signerKeyId"] as string;
  const signerEntry = findKey(prev.payload["keys"] as KeyEntry[], signerKeyId);
  if (signerEntry === undefined) {
    return { wire, record: parsed, accepted: false, verdict: "UNKNOWN_AUTHORITY", phase: 5, reason: "signer-outside-accepted-chain" };
  }
  if (signerEntry.status !== "current") {
    return { wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "signer-not-current-in-previous-record" };
  }
  const issuedAt = payload["issuedAt"] as number;
  if (issuedAt < signerEntry.validFrom || issuedAt > signerEntry.validUntil) {
    return { wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "signer-window-excludes-record-issuedAt" };
  }
  if (!verifyEd25519(signerEntry.publicKey, parsed.signature, parsed.payloadWireText)) {
    return { wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "record-signature-fails-under-previous-key" };
  }

  const transfer = payload["transfer"];
  const epochId = payload["epochId"] as string;
  const prevEpoch = prev.payload["epochId"] as string;
  if (transfer === undefined) {
    if (epochId !== prevEpoch) {
      return { wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "epoch-change-without-transfer" };
    }
    if ((payload["statementFloor"] as number) !== (prev.payload["statementFloor"] as number)) {
      return { wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "floor-changed-without-transfer" };
    }
  } else {
    if (epochId === prevEpoch) {
      return { wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "transfer-without-epoch-change" };
    }
    if (acceptedEpochs.includes(epochId)) {
      return { wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "epoch-already-accepted" };
    }
    if ((payload["statementFloor"] as number) !== 0) {
      return { wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "floor-not-zero-on-transfer" };
    }
    const trailFailures = checkTrail(parsed, prev, signerEntry, issuedAt, acceptedEpochs);
    if (trailFailures.length > 0) {
      return { wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: trailFailures.join(",") };
    }
  }

  const introducesNewKey = (payload["keys"] as KeyEntry[]).some(
    entry => entry.status === "current" && entry.validFrom === issuedAt && findKey(prev.payload["keys"] as KeyEntry[], entry.keyId) === undefined
  );
  const mutationViolations = validateKeyMutation({
    prevKeys: prev.payload["keys"] as KeyEntry[],
    nextKeys: payload["keys"] as KeyEntry[],
    recordGeneration: generation,
    issuedAt,
    isTransfer: transfer !== undefined,
    introducesNewKey,
    incomingKeyId: transfer === undefined ? undefined : findTransferIncoming(parsed.payload.transfer as TransferEnvelope)
  });
  if (mutationViolations.length > 0) {
    return { wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: mutationViolations.map(v => v.rule).join(",") };
  }

  return { wire, record: parsed, accepted: true, verdict: "ACCEPTED", phase: 5, reason: "accepted" };
}

function evaluateRecordZero(parsed: ParsedRecord, anchor: TrustAnchorBinding, policyChannelProvenance: boolean): RecordEvaluation {
  const payload = parsed.payload;
  if (payload["prevRecordDigest"] !== null) {
    return { wire: parsed.wire, record: parsed, accepted: false, verdict: "INVALID", phase: 5, reason: "record0-prev-digest-not-null" };
  }
  if (payload["anchorId"] !== anchor.anchorId || payload["entityId"] !== anchor.entityId) {
    return { wire: parsed.wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "record0-anchor-binding-mismatch" };
  }
  if (payload["epochId"] !== anchor.epochId) {
    return { wire: parsed.wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "record0-epoch-mismatch" };
  }
  if ((payload["statementFloor"] as number) !== anchor.statementFloor) {
    return { wire: parsed.wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "record0-floor-mismatch" };
  }
  if (payload["signerKeyId"] !== anchor.keyId) {
    return { wire: parsed.wire, record: parsed, accepted: false, verdict: "UNKNOWN_AUTHORITY", phase: 5, reason: "record0-signer-against-binding-keyid" };
  }
  const entry = findKey(payload["keys"] as KeyEntry[], anchor.keyId);
  if (entry === undefined) {
    return { wire: parsed.wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "record0-missing-binding-key" };
  }
  if (entry.publicKey !== anchor.publicKey || entry.algorithm !== anchor.algorithm) {
    return { wire: parsed.wire, record: parsed, accepted: false, verdict: "UNKNOWN_AUTHORITY", phase: 5, reason: "record0-binding-key-material-mismatch" };
  }
  if (!verifyEd25519(anchor.publicKey, parsed.signature, parsed.payloadWireText)) {
    return { wire: parsed.wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "record0-signature-fails-under-binding-key" };
  }
  if (!policyChannelProvenance) {
    return { wire: parsed.wire, record: parsed, accepted: false, verdict: "UNVERIFIED", phase: 5, reason: "record0-material-provenance-not-policy-channel" };
  }
  return { wire: parsed.wire, record: parsed, accepted: true, verdict: "ACCEPTED", phase: 5, reason: "accepted" };
}

function checkTrail(
  parsed: ParsedRecord,
  prev: ParsedRecord,
  signerEntry: KeyEntry,
  issuedAt: number,
  acceptedEpochs: string[]
): string[] {
  const failures: string[] = [];
  const payload = parsed.payload;
  const trail = parsed.payload.transfer as TransferEnvelope;
  const trailPayload = trail.payload;
  const prevKeys = prev.payload["keys"] as KeyEntry[];

  const incomingKey = findKey(payload["keys"] as KeyEntry[], trailPayload["incomingKeyId"] as string);
  if (incomingKey === undefined) {
    failures.push("trail-incoming-key-not-introduced");
    return failures;
  }

  if (trailPayload["outgoingKeyId"] !== payload["signerKeyId"]) {
    failures.push("trail-outgoing-keyid-not-signer");
  }
  if (trailPayload["epochId"] !== prev.payload["epochId"]) {
    failures.push("trail-epochid-not-previous-epoch");
  }
  if (trailPayload["newEpochId"] !== payload["epochId"]) {
    failures.push("trail-newepochid-not-record-epoch");
  }
  if (trailPayload["recordGeneration"] !== payload["recordGeneration"]) {
    failures.push("trail-recordgeneration-not-record-generation");
  }
  if (trailPayload["statementFloor"] !== payload["statementFloor"]) {
    failures.push("trail-statementfloor-not-record-floor");
  }
  if (trailPayload["anchorId"] !== payload["anchorId"] || trailPayload["entityId"] !== payload["entityId"]) {
    failures.push("trail-identity-mismatch");
  }
  if (trailPayload["algorithm"] !== payload["algorithm"]) {
    failures.push("trail-algorithm-mismatch");
  }
  if (trailPayload["incomingKeyId"] === payload["signerKeyId"]) {
    failures.push("trail-self-signing-introduction-rejected");
  }
  if (acceptedEpochs.includes(trailPayload["newEpochId"] as string)) {
    failures.push("trail-newepoch-previously-accepted");
  }
  const outgoing = findKey(prevKeys, trailPayload["outgoingKeyId"] as string);
  if (outgoing === undefined) {
    failures.push("trail-outgoing-key-not-in-previous-record");
    return failures;
  }
  if (!verifyEd25519(outgoing.publicKey, trail.signature, jcsCanonicalize(trailPayload))) {
    failures.push("trail-signature-fails-under-outgoing-key");
  }
  if (issuedAt < outgoing.validFrom || issuedAt > outgoing.validUntil) {
    failures.push("trail-window-excludes-record-issuedAt");
  }
  // The incoming key must be the sole new current key introduced by this Record.
  const currentInG = (payload["keys"] as KeyEntry[]).filter(entry => entry.status === "current");
  if (currentInG.length !== 1 || currentInG[0]?.keyId !== trailPayload["incomingKeyId"]) {
    failures.push("trail-incoming-key-not-sole-current");
  }
  return failures;
}

export function findKey(keys: KeyEntry[], keyId: string): KeyEntry | undefined {
  for (const entry of keys) {
    if (entry.keyId === keyId) {
      return entry;
    }
  }
  return undefined;
}
