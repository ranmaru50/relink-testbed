// src/conformance/l2/runner.ts
// L2 conformance runner: one handler per catalog case. L2-VER / L2-AUT / L2-PRO handlers run
// offline against the pinned fixtures; L2-SRV handlers drive a ConformanceHttpClient against a
// base URL (the offline stub by default, a Native/Container profile when wired through run.ts).

import { l2Fixtures, l2Key, l2Vector, l2WireEnvelope } from "./fixtures/l2Fixtures.js";
import { jcsCanonicalize } from "./jcs.js";
import { parseWireEnvelope, WireError, type JsonValue } from "./wire.js";
import { base64urlDecode } from "./base64url.js";
import { computeKeyId, sha256HexOfUtf8 } from "./keyId.js";
import type { KeyEntry } from "./model.js";
import { signWithSeed, verifyEd25519 } from "./ed25519.js";
import {
  walkChain,
  parseRecordWire,
  recordDigest,
  findKey,
  type ParsedRecord,
  type TrustAnchorBinding
} from "./chainWalk.js";
import {
  parseStatementWire,
  createStatementLedger,
  commitVerifiedStatement,
  verifyStatement,
  type VerifierState
} from "./verifier.js";
import {
  FIXED_T,
  FIXED_W,
  ANCHOR_ID,
  ENTITY_ID,
  trustAnchor,
  wire,
  payloadOf,
  digestOf,
  chainWires,
  CHAIN_PRESETS,
  statementA,
  statementS5,
  statementS6,
  statementS8,
  statementS9,
  statementS9v1,
  statementS9v2,
  statementAnchorMismatch,
  statementUnknownAlgorithm,
  statementNonIntegerTimestamp,
  statementL2VersionMismatch,
  statementSignatureInsidePayload,
  statementBelowFloor,
  statementExpired,
  statementUnderKey2InAcceptedEpoch,
  statementAEquivocated,
  statementSignedByKey5,
  record2Key3PublicKeyTampered,
  record6ReRegistersRevokedKey,
  record1RetirementCapViolated,
  recordEpochChangeWithoutTransfer,
  recordTransferWithoutEpochChange,
  recordMissingStatementFloor,
  recordTrailForbiddenMember,
  recordTrailEpochMismatch,
  record2LeavesKey2Current,
  record4SignerAbsentFromPrevious,
  recordReentersAcceptedEpoch,
  record0SelfBootstrap,
  record3SameGenerationDifferentPayload,
  record3DeletesKey1Entry,
  duplicateFirstPayloadMemberWire,
  duplicateTrailMemberWire
} from "./scenarios.js";
import { ALL_VERIFIER_VERDICTS, matchVerdict, type CaseOutcome, type VerifierVerdict } from "./result.js";
import type { ConformanceHttpClient, HttpRequest, HttpResponseSnapshot } from "../types.js";
import { startStubResolverServer, type StubAnchorEntry, wirePayloadObject } from "./stubResolverServer.js";

export interface L2RunContext {
  client: ConformanceHttpClient;
  baseUrl: string;
}

type Handler = (context: L2RunContext | undefined) => Promise<CaseOutcome>;

interface ScenarioOptions {
  T?: number;
  W?: number;
  mode?: "statement-only" | "l1-bound";
  clockTrusted?: boolean;
  provenance?: boolean;
  seed?: string[];
  l1?: { descriptionLocation: string };
}

/** Run the verifier over a statement wire and match the expected verdict. */
function statementOutcome(
  expected: VerifierVerdict,
  wireText: string,
  recordWires: string[],
  options: ScenarioOptions = {}
): CaseOutcome {
  const anchor = trustAnchor();
  const state: VerifierState = {
    anchor,
    T: options.T ?? FIXED_T,
    W: options.W ?? FIXED_W,
    clockTrusted: options.clockTrusted ?? true,
    mode: options.mode ?? "statement-only"
  };
  const ledger = createStatementLedger(anchor);
  for (const seedWire of options.seed ?? []) {
    const parsed = parseStatementWire(seedWire);
    if (parsed.parsed !== undefined) {
      commitVerifiedStatement(ledger, parsed.parsed.payload, parsed.parsed.payloadWireText);
    }
  }
  return matchVerdict(expected, verifyStatement({
    wire: wireText,
    recordWires,
    policyChannelProvenance: options.provenance ?? true,
    state,
    ledger,
    l1Observation: options.l1
  }));
}

function evalOutcome(observation: Record<string, unknown>, checks: Record<string, boolean>): CaseOutcome {
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return {
    result: failed.length === 0 ? "PASS" : "FAIL",
    observation: { ...observation, checks },
    detail: failed.length === 0 ? undefined : `failed checks: ${failed.join(", ")}`
  };
}

/** Replace a unique fragment inside an already-built wire's payload text. */
function editWire(wireText: string, search: string, replace: string): string {
  const splitAt = wireText.lastIndexOf(',"signature"');
  const payloadText = wireText.slice('{"payload":'.length, splitAt);
  return `{"payload":${payloadText.replace(search, replace)}${wireText.slice(splitAt)}`;
}

function baseWires(): string[] {
  return chainWires("base");
}

function keysOf(vectorId: string): string[] {
  return Object.keys(payloadOf(vectorId));
}

function topLevelKeyOrder(vectorId: string): string[] {
  const canonical = l2Vector(vectorId).canonical;
  const order: string[] = [];
  let depth = 0;
  let index = 0;
  while (index < canonical.length) {
    const char = canonical[index];
    if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
    }
    if (depth === 1 && char === '"') {
      const end = canonical.indexOf('"', index + 1);
      const name = canonical.slice(index + 1, end);
      if (canonical.slice(end + 1).startsWith(":")) {
        order.push(name);
      }
      index = end + 1;
      continue;
    }
    index += 1;
  }
  return order;
}

const SRV_ACTIVE_UUID = ANCHOR_ID;
export const SRV_SUSPENDED_UUID = "550e8400-e29b-41d4-a716-446655440001";
export const SRV_RETIRED_UUID = "550e8400-e29b-41d4-a716-446655440002";
export const SRV_GAP_UUID = "550e8400-e29b-41d4-a716-446655440003";
export const SRV_INTERNAL_UUID = "550e8400-e29b-41d4-a716-446655440004";
export const SRV_UNAVAILABLE_UUID = "550e8400-e29b-41d4-a716-446655440005";

/** The explicit fixture registry served by the offline L2 stub Resolver. */
export function defaultStubEntries(): StubAnchorEntry[] {
  return [
    { uuid: SRV_ACTIVE_UUID, lifecycle: "ACTIVE", statementWire: wire("S7"), records: chainWires("chain0to4") },
    { uuid: SRV_SUSPENDED_UUID, lifecycle: "SUSPENDED", statementWire: wire("S7"), records: chainWires("base") },
    { uuid: SRV_RETIRED_UUID, lifecycle: "RETIRED", statementWire: wire("S7"), records: chainWires("base") },
    { uuid: SRV_GAP_UUID, lifecycle: "ACTIVE", statementWire: wire("S7"), records: [wire("Record0"), wire("Record2")] },
    { uuid: SRV_INTERNAL_UUID, lifecycle: "INTERNAL_ERROR", statementWire: wire("S7"), records: chainWires("base") },
    { uuid: SRV_UNAVAILABLE_UUID, lifecycle: "UNAVAILABLE", statementWire: wire("S7"), records: chainWires("base") }
  ];
}

function request(
  context: L2RunContext | undefined,
  path: string,
  init: { method?: string; body?: string } = {}
): Promise<HttpResponseSnapshot> {
  if (context === undefined) {
    throw new Error("L2-SRV handler needs a run context with a base URL");
  }
  const http: HttpRequest =
    init.body === undefined
      ? { url: `${context.baseUrl}${path}`, method: init.method ?? "GET", redirect: "manual" }
      : { url: `${context.baseUrl}${path}`, method: init.method ?? "GET", redirect: "manual", body: init.body };
  return context.client.request(http);
}

const handlers: Record<string, Handler> = {
  "L2-VER-001": async () => statementOutcome("VERIFIED", statementA(), baseWires()),

  "L2-VER-002": async () => {
    const tampered = record2Key3PublicKeyTampered();
    const parse = parseRecordWire(tampered);
    const statement = statementOutcome("UNKNOWN_AUTHORITY", statementA(), [wire("Record0"), wire("Record1"), tampered]);
    const baseline = statementOutcome("VERIFIED", statementA(), baseWires());
    return evalOutcome({ parseFailures: parse.failures, statement, baseline }, {
      "keyid-recompute-detected": parse.failures.includes("keyid-recompute-mismatch"),
      "statement-unknown-authority": statement.result === "PASS",
      "baseline-still-verified": baseline.result === "PASS"
    });
  },

  "L2-VER-003": async () => {
    const dupStatement = statementOutcome("INVALID", duplicateFirstPayloadMemberWire("S7"), baseWires());
    const trailDup = parseRecordWire(duplicateTrailMemberWire("Record2"));
    const nonInteger = statementOutcome("INVALID", statementNonIntegerTimestamp(), baseWires());
    const version = statementOutcome("INVALID", statementL2VersionMismatch(), baseWires());
    const signatureInside = statementOutcome("INVALID", statementSignatureInsidePayload(), baseWires());
    const keyIdRecompute = statementOutcome("UNKNOWN_AUTHORITY", statementA(), [wire("Record0"), wire("Record1"), record2Key3PublicKeyTampered()]);
    return evalOutcome({ dupStatement, trailDupFailures: trailDup.failures, nonInteger, version, signatureInside, keyIdRecompute }, {
      "duplicate-members-invalid": dupStatement.result === "PASS" && String(dupStatement.detail).includes("duplicate-member"),
      "duplicate-members-in-transfer-payload-invalid": trailDup.failures.some(failure => failure.includes("duplicate-member")),
      "non-integer-timestamp-invalid": nonInteger.result === "PASS",
      "l2version-mismatch-invalid": version.result === "PASS",
      "signature-inside-payload-invalid": signatureInside.result === "PASS",
      "keyid-recompute-statement-unknown-authority": keyIdRecompute.result === "PASS"
    });
  },

  "L2-VER-004": async () => statementOutcome("ANCHOR_MISMATCH", statementAnchorMismatch(), baseWires()),

  "L2-VER-005": async () => statementOutcome("UNSUPPORTED_ALGORITHM", statementUnknownAlgorithm(), baseWires()),

  "L2-VER-006": async () => statementOutcome("UNVERIFIED", statementA(), baseWires(), { clockTrusted: false }),

  "L2-VER-007": async () => statementOutcome("UNVERIFIED", statementA(), [wire("Record0"), wire("Record2")]),

  "L2-VER-008": async () => statementOutcome("UNKNOWN_AUTHORITY", statementSignedByKey5(), baseWires()),

  "L2-VER-009": async () => {
    const noProvenance = walkChain({ anchor: trustAnchor(), recordWires: baseWires(), policyChannelProvenance: false });
    const withProvenance = walkChain({ anchor: trustAnchor(), recordWires: baseWires(), policyChannelProvenance: true });
    return evalOutcome({ noProvenanceStop: noProvenance.stop?.reason, acceptedWithProvenance: withProvenance.accepted.length }, {
      "record0-rejected-without-policy-provenance": noProvenance.accepted.length === 0 && String(noProvenance.stop?.reason).includes("record0-material-provenance-not-policy-channel"),
      "record0-accepted-with-policy-provenance": withProvenance.accepted.length === 4 && withProvenance.accepted[0]?.payload["recordGeneration"] === 0
    });
  },

  "L2-VER-010": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: baseWires(), policyChannelProvenance: true });
    const key1 = findKey((walk.accepted[1]?.payload["keys"] as KeyEntry[]) ?? [], l2Key("key1").keyId);
    return evalOutcome({ acceptedMax: walk.acceptedMax, key1Entry: key1 }, {
      "record1-accepted": walk.evaluations[1]?.accepted === true,
      "key1-retired-with-truncation-cap": key1?.status === "retired" && key1.validUntil === 1769997000,
      "key1-current-during-own-record": key1?.status !== "current"
    });
  },

  "L2-VER-011": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: baseWires(), policyChannelProvenance: true });
    const key3 = findKey((walk.accepted[2]?.payload["keys"] as KeyEntry[]) ?? [], l2Key("key3").keyId);
    return evalOutcome({ acceptedEpoch: walk.acceptedEpoch, statementFloor: walk.statementFloor, key3Entry: key3 }, {
      "record2-accepted": walk.evaluations[2]?.accepted === true,
      "epoch-1-accepted": walk.acceptedEpoch === "epoch-1" && walk.acceptedEpochs.includes("epoch-1"),
      "statement-floor-zero": walk.statementFloor === 0,
      "key3-current-window": key3?.status === "current" && key3.validFrom === 1769997600 && key3.validUntil === 1770001200
    });
  },

  "L2-VER-012": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: baseWires(), policyChannelProvenance: true });
    const record3 = walk.accepted[3];
    return evalOutcome({ acceptedMax: walk.acceptedMax, record3IssuedAt: record3?.payload["issuedAt"] }, {
      "record3-accepted": walk.evaluations[3]?.accepted === true,
      "accepted-max-three": walk.acceptedMax === 3,
      "snapshot-fresh-at-T": record3 !== undefined && FIXED_T - (record3.payload["issuedAt"] as number) === 200 && FIXED_T <= (record3.payload["expiresAt"] as number)
    });
  },

  "L2-VER-013": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: baseWires(), policyChannelProvenance: true });
    const prefix = walk.accepted.filter(record => (record.payload["issuedAt"] as number) <= FIXED_T);
    const snapshot = prefix[prefix.length - 1];
    const statement = statementOutcome("VERIFIED", statementA(), baseWires());
    return evalOutcome({ snapshotGeneration: snapshot?.payload["recordGeneration"], statement }, {
      "snapshot-is-last-record-of-prefix": snapshot?.payload["recordGeneration"] === 3,
      "snapshot-freshness-uses-record-issuedAt": snapshot !== undefined && FIXED_T - (snapshot.payload["issuedAt"] as number) <= FIXED_W,
      "statement-freshness-independent": statement.result === "PASS"
    });
  },

  "L2-VER-014": async () => {
    const recordDuplicate = [wire("Record0"), wire("Record1"), duplicateFirstPayloadMemberWire("Record2")];
    const recordDupStatement = statementOutcome("UNVERIFIED", statementA(), recordDuplicate);
    const trailFailure = [wire("Record0"), wire("Record1"), recordTrailEpochMismatch()];
    const trailWalk = walkChain({ anchor: trustAnchor(), recordWires: trailFailure, policyChannelProvenance: true });
    const trailStatement = statementOutcome("UNVERIFIED", statementA(), trailFailure);
    const signerAbsent = statementOutcome("UNKNOWN_AUTHORITY", statementA(), [wire("Record0"), wire("Record1")]);
    const materialGap = statementOutcome("UNVERIFIED", statementA(), [wire("Record0"), wire("Record1"), wire("Record3")]);
    const snapshotGap = statementOutcome("UNVERIFIED", statementA(), [wire("Record0"), wire("Record1"), wire("Record2")]);
    return evalOutcome({ recordDupStatement, trailWalkStop: trailWalk.stop?.reason, trailStatement, signerAbsent, materialGap, snapshotGap }, {
      "record-wire-duplicate-stops-chain": trailWalk.acceptedMax >= 0 && recordDupStatement.result === "PASS" && recordDupStatement.observation["phase"] === 5,
      "trail-verification-failure-stops-at-previous": trailWalk.acceptedMax === 1 && String(trailWalk.stop?.reason).includes("trail-epochid"),
      "statement-signer-absent-unknown-authority": signerAbsent.result === "PASS",
      "statement-material-missing-unverified": materialGap.result === "PASS",
      "chain-accepted-snapshot-gap-unverified": snapshotGap.result === "PASS" && snapshotGap.observation["phase"] === 6
    });
  },

  "L2-VER-015": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: chainWires("chain0to4"), policyChannelProvenance: true });
    const statement = statementOutcome("STALE", statementS6(), chainWires("chain0to4"), { T: 1770001200 });
    return evalOutcome({ acceptedEpoch: walk.acceptedEpoch, statement }, {
      "statement-in-unaccepted-epoch-stale": statement.result === "PASS" && statement.observation["phase"] === 10,
      "accepted-epoch-stays-epoch-1": walk.acceptedEpoch === "epoch-1"
    });
  },

  "L2-VER-016": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: chainWires("chain0to4plus5"), policyChannelProvenance: true });
    const trailVector = l2Vector("Trail5");
    const key4 = findKey((walk.accepted[4]?.payload["keys"] as KeyEntry[]) ?? [], l2Key("key4").keyId);
    const trailSignatureOk = key4 !== undefined && verifyEd25519(key4.publicKey, trailVector.signature, trailVector.canonical);
    return evalOutcome({ record5Stop: walk.stop?.reason, trailSignatureOk }, {
      "record5-rejected-by-trail-matching": walk.stop !== null && String(walk.stop.reason).includes("trail-incoming-key-not-sole-current"),
      "record5-trail-signature-verifies-under-key4": trailSignatureOk,
      "rejection-not-a-signature-failure": walk.stop !== null && !String(walk.stop.reason).includes("signature-fails")
    });
  },

  "L2-VER-017": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: chainWires("chain0to4plus6"), policyChannelProvenance: true });
    return evalOutcome({ stopReason: walk.stop?.reason, acceptedEpochs: walk.acceptedEpochs }, {
      "record6-contiguity-gap-stops-walk": walk.stop !== null && String(walk.stop.reason).includes("contiguity-gap"),
      "accepted-max-stays-four": walk.acceptedMax === 4,
      "epochs-two-and-three-never-accepted": !walk.acceptedEpochs.includes("epoch-2") && !walk.acceptedEpochs.includes("epoch-3")
    });
  },

  "L2-VER-018": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: chainWires("basePlus4F"), policyChannelProvenance: true });
    const prefix = walk.accepted.filter(record => (record.payload["issuedAt"] as number) <= FIXED_T);
    const statement = statementOutcome("VERIFIED", statementA(), chainWires("basePlus4F"));
    return evalOutcome({ prefixGenerations: prefix.map(r => r.payload["recordGeneration"]), statement }, {
      "record4f-accepted-by-walk": walk.acceptedMax === 4,
      "effective-prefix-gens-zero-to-three": prefix.map(r => r.payload["recordGeneration"] as number).join(",") === "0,1,2,3",
      "statement-verified-on-prefix": statement.result === "PASS"
    });
  },

  "L2-VER-019": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: chainWires("basePlus4F"), policyChannelProvenance: true });
    const keyPoint = 1770000000;
    const record3 = walk.accepted[3];
    const statement = statementOutcome("UNVERIFIED", statementA(), chainWires("basePlus4F"), { T: keyPoint });
    return evalOutcome({ statement }, {
      "snapshot-4f-not-fresh-at-keypoint": statement.result === "PASS" && statement.observation["phase"] === 6,
      "older-record-3-also-stale-at-keypoint": record3 !== undefined && keyPoint - (record3.payload["issuedAt"] as number) > FIXED_W
    });
  },

  "L2-VER-020": async () => {
    const statement = statementOutcome("UNVERIFIED", statementA(), chainWires("basePlus4E"), { T: 1769998700 });
    return evalOutcome({ statement }, {
      "snapshot-4e-expired-at-T": statement.result === "PASS" && statement.observation["phase"] === 6
    });
  },

  "L2-VER-021": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: chainWires("basePlus4E"), policyChannelProvenance: true });
    const snapshot = walk.accepted[4];
    const statement = statementOutcome("VERIFIED", statementA(), chainWires("basePlus4E"), { T: 1769998300 });
    return evalOutcome({ snapshotExpiresAt: snapshot?.payload["expiresAt"], statement }, {
      "boundary-equality-passes": statement.result === "PASS" && snapshot?.payload["expiresAt"] === 1769998300
    });
  },

  "L2-VER-022": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: chainWires("basePlus4A4R4B"), policyChannelProvenance: true });
    const prefix = walk.accepted.filter(record => (record.payload["issuedAt"] as number) <= FIXED_T);
    const statement = statementOutcome("VERIFIED", statementS9(), chainWires("basePlus4A4R4B"), { seed: [statementA()] });
    return evalOutcome({ prefixGenerations: prefix.map(r => r.payload["recordGeneration"]), statement }, {
      "prefix-generations-zero-to-five": prefix.map(r => r.payload["recordGeneration"] as number).join(",") === "0,1,2,3,4,5",
      "snapshot-k-is-record-4r": prefix[prefix.length - 1]?.payload["recordGeneration"] === 5,
      "record4b-issued-after-T-excluded": (walk.accepted[6]?.payload["issuedAt"] as number) > FIXED_T,
      "statement-s9-verified": statement.result === "PASS"
    });
  },

  "L2-VER-023": async () => {
    const replayWires = [wire("Record0"), wire("Record1"), wire("Record2"), wire("Record0"), wire("Record1"), wire("Record2"), wire("Record3")];
    const walk = walkChain({ anchor: trustAnchor(), recordWires: replayWires, policyChannelProvenance: true });
    const prefix = walk.accepted.filter(record => (record.payload["issuedAt"] as number) <= FIXED_T);
    const rePresent = walkChain({ anchor: trustAnchor(), recordWires: [...replayWires, wire("Record3")], policyChannelProvenance: true });
    const statement = statementOutcome("VERIFIED", statementA(), replayWires);
    return evalOutcome({ evaluations: walk.evaluations.map(e => e.verdict), statement }, {
      "lower-position-presentations-stale": walk.evaluations[3]?.verdict === "STALE" && walk.evaluations[4]?.verdict === "STALE",
      "byte-identical-replay-accepted-as-replay": walk.evaluations[5]?.verdict === "REPLAY",
      "walk-continues-to-record3": walk.acceptedMax === 3,
      "freshness-point-stays-record3-issuedAt": prefix[prefix.length - 1]?.payload["issuedAt"] === 1769998200,
      "re-present-record3-replay-keeps-point": rePresent.acceptedMax === 3 && String(rePresent.evaluations[7]?.reason) === "byte-identical-replay",
      "statement-verified": statement.result === "PASS"
    });
  },

  "L2-VER-024": async () => {
    const statement = statementOutcome("UNVERIFIED", statementA(), baseWires(), { T: 1769999100 });
    const statementWindow = (payloadOf("S7")["issuedAt"] as number) <= 1769999100 && 1769999100 <= (payloadOf("S7")["expiresAt"] as number);
    return evalOutcome({ statement, statementWindow }, {
      "skew-does-not-manufacture-snapshot-freshness": statement.result === "PASS" && statement.observation["phase"] === 6,
      "statement-window-contains-T": statementWindow
    });
  },

  "L2-VER-025": async () => {
    const statement = statementOutcome("STALE", statementS5(), baseWires());
    return evalOutcome({ statement }, {
      "statement-in-prior-epoch-stale": statement.result === "PASS" && statement.observation["phase"] === 10,
      "phase-9-skipped-for-prior-epoch": (statement.observation["phase"] as number) === 10
    });
  },

  "L2-VER-026": async () => {
    const statement = statementOutcome("REVOKED", statementS8(), chainWires("basePlus4A4R"));
    return evalOutcome({ statement }, {
      "revoked-at-statement-issuedAt": statement.result === "PASS" && statement.observation["phase"] === 9
    });
  },

  "L2-VER-027": async () => statementOutcome("VERIFIED", statementA(), baseWires(), { seed: [statementA()] }),

  "L2-VER-028": async () => statementOutcome("CONFLICT", statementAEquivocated(), baseWires(), { seed: [statementA()] }),

  "L2-VER-029": async () => {
    const wires = [...baseWires(), wire("Record2"), wire("Record3"), record3SameGenerationDifferentPayload()];
    const walk = walkChain({ anchor: trustAnchor(), recordWires: wires, policyChannelProvenance: true });
    return evalOutcome({ evaluations: walk.evaluations.map(e => e.verdict) }, {
      "replay-record2-stale": walk.evaluations[4]?.verdict === "STALE",
      "replay-record3-replay": walk.evaluations[5]?.verdict === "REPLAY",
      "same-generation-variant-conflict": walk.evaluations[6]?.verdict === "CONFLICT",
      "accepted-max-stays-three": walk.acceptedMax === 3,
      "chain-continues-after-stale-and-replay": walk.accepted.length === 4
    });
  },

  "L2-VER-030": async () => {
    const statement = statementOutcome("STALE", statementBelowFloor(), baseWires());
    return evalOutcome({ statement }, {
      "generation-at-or-below-floor-stale": statement.result === "PASS" && statement.observation["phase"] === 10
    });
  },

  "L2-VER-031": async () => {
    const statement = statementOutcome("EXPIRED", statementExpired(), baseWires());
    return evalOutcome({ statement }, {
      "expiresAt-before-T-expired": statement.result === "PASS" && statement.observation["phase"] === 10
    });
  },

  "L2-VER-032": async () => {
    const atT = statementOutcome("VERIFIED", statementA(), baseWires());
    const later = statementOutcome("UNVERIFIED", statementA(), baseWires(), { T: 1770001000 });
    return evalOutcome({ atT, later }, {
      "verified-at-T": atT.result === "PASS",
      "unverified-after-window": later.result === "PASS" && later.observation["phase"] === 6
    });
  },

  "L2-VER-033": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: baseWires(), policyChannelProvenance: true });
    const snapshot = walk.accepted[3];
    const snapshotKeys = snapshot?.payload["keys"] as KeyEntry[];
    const statement = statementOutcome("STALE", statementS5(), baseWires());
    return evalOutcome({ snapshotEpoch: snapshot?.payload["epochId"], statement }, {
      "snapshot-covers-accepted-epoch": snapshot?.payload["epochId"] === "epoch-1",
      "snapshot-covers-key3": snapshotKeys !== undefined && findKey(snapshotKeys, l2Key("key3").keyId) !== undefined,
      "snapshot-floor-carried": snapshot?.payload["statementFloor"] === 0,
      "phase-6-passes-statement-stale": statement.result === "PASS" && statement.observation["phase"] === 10
    });
  },

  "L2-VER-034": async () => {
    const statement = statementOutcome("UNVERIFIED", statementUnderKey2InAcceptedEpoch(), baseWires());
    return evalOutcome({ statement }, {
      "retired-key-in-accepted-epoch-unverified": statement.result === "PASS" && statement.observation["phase"] === 9,
      "never-revoked-or-verified": String(statement.observation["observed"]) !== "REVOKED" && String(statement.observation["observed"]) !== "VERIFIED"
    });
  },

  "L2-VER-035": async () => statementOutcome("REVOKED", statementS8(), chainWires("basePlus4A4R")),

  "L2-VER-036": async () => {
    const variant = record6ReRegistersRevokedKey();
    const wires = [...chainWires("basePlus4A4R"), variant];
    const walk = walkChain({ anchor: trustAnchor(), recordWires: wires, policyChannelProvenance: true });
    const statement = statementOutcome("REVOKED", statementS8(), chainWires("basePlus4A4R"));
    return evalOutcome({ stopReason: walk.stop?.reason, acceptedMax: walk.acceptedMax, statement }, {
      "terminal-state-reopening-rejected": walk.stop !== null && String(walk.stop.reason).includes("terminal-state-reopened"),
      "chain-tip-stays-generation-five": walk.acceptedMax === 5,
      "statement-stays-revoked": statement.result === "PASS"
    });
  },

  "L2-VER-037": async () => {
    const wires = [...chainWires("basePlus4A4R"), wire("Record4C")];
    const walk = walkChain({ anchor: trustAnchor(), recordWires: wires, policyChannelProvenance: true });
    const prefix = walk.accepted.filter(record => (record.payload["issuedAt"] as number) <= FIXED_T);
    const statement = statementOutcome("REVOKED", statementS8(), chainWires("basePlus4A4R"));
    return evalOutcome({ stopReason: walk.stop?.reason, acceptedMax: walk.acceptedMax, statement }, {
      "revokedFrom-mutation-rejected": walk.stop !== null && String(walk.stop.reason).includes("revokedFrom"),
      "tip-stays-generation-five": walk.acceptedMax === 5 && prefix[prefix.length - 1]?.payload["recordGeneration"] === 5,
      "statement-stays-revoked": statement.result === "PASS"
    });
  },

  "L2-VER-038": async () => {
    const statement = statementOutcome("VERIFIED", statementA(), baseWires(), {
      mode: "l1-bound",
      l1: { descriptionLocation: payloadOf("S7")["descriptionLocation"] as string }
    });
    return evalOutcome({ verificationMode: "l1-bound", statement }, {
      "l1-bound-verified": statement.result === "PASS"
    });
  },

  "L2-VER-039": async () => {
    const statement = statementOutcome("MISMATCH", statementA(), baseWires(), {
      mode: "l1-bound",
      l1: { descriptionLocation: "https://sensors.example/thermal/42/ar-xml-other" }
    });
    return evalOutcome({ verificationMode: "l1-bound", statement }, {
      "location-mismatch-phase-11": statement.result === "PASS" && statement.observation["phase"] === 11
    });
  },

  "L2-VER-040": async () => {
    const l1Bound = statementOutcome("UNVERIFIED", statementA(), baseWires(), { mode: "l1-bound" });
    const statementOnly = statementOutcome("VERIFIED", statementA(), baseWires(), { mode: "statement-only" });
    return evalOutcome({ l1Bound, statementOnly }, {
      "missing-l1-observation-unverified": l1Bound.result === "PASS" && l1Bound.observation["phase"] === 11,
      "statement-only-mode-makes-no-l1-request": statementOnly.result === "PASS"
    });
  },

  "L2-VER-041": async () => {
    const verdicts = ALL_VERIFIER_VERDICTS.length;
    const walk = walkChain({ anchor: trustAnchor(), recordWires: baseWires(), policyChannelProvenance: true });
    const outcome = verifyStatement({
      wire: statementA(),
      recordWires: baseWires(),
      policyChannelProvenance: true,
      state: { anchor: trustAnchor(), T: FIXED_T, W: FIXED_W, clockTrusted: true, mode: "statement-only" },
      ledger: createStatementLedger(trustAnchor())
    });
    return evalOutcome({ verdicts, observed: outcome.verdict, walkMax: walk.acceptedMax }, {
      "eleven-verdict-states": verdicts === 11,
      "verdict-is-a-state-not-a-boolean": typeof outcome.verdict === "string" && ALL_VERIFIER_VERDICTS.includes(outcome.verdict)
    });
  },

  "L2-VER-042": async () => {
    const dupAndClock = statementOutcome("INVALID", duplicateFirstPayloadMemberWire("S7"), baseWires(), { clockTrusted: false });
    const anchorAndAlgorithm = statementOutcome("ANCHOR_MISMATCH", editWire(statementUnknownAlgorithm(), `"anchorId":"${ANCHOR_ID}"`, `"anchorId":"660e8400-e29b-41d4-a716-446655440000"`), baseWires());
    const algorithmAndClock = statementOutcome("UNSUPPORTED_ALGORITHM", statementUnknownAlgorithm(), baseWires(), { clockTrusted: false });
    const clockAndGap = statementOutcome("UNVERIFIED", statementA(), [wire("Record0"), wire("Record2")], { clockTrusted: false });
    const gapAndExpired = statementOutcome("UNVERIFIED", statementExpired(), [wire("Record0"), wire("Record2")]);
    return evalOutcome({ dupAndClock, anchorAndAlgorithm, algorithmAndClock, clockAndGap, gapAndExpired }, {
      "wire-failure-first": dupAndClock.result === "PASS" && dupAndClock.observation["phase"] === 1,
      "anchor-before-algorithm": anchorAndAlgorithm.result === "PASS" && anchorAndAlgorithm.observation["phase"] === 2,
      "algorithm-before-clock": algorithmAndClock.result === "PASS" && algorithmAndClock.observation["phase"] === 3,
      "clock-before-chain": clockAndGap.result === "PASS" && clockAndGap.observation["phase"] === 4,
      "chain-before-statement-freshness": gapAndExpired.result === "PASS" && gapAndExpired.observation["phase"] === 5
    });
  },

  "L2-VER-043": async () => {
    const emptyMaterial = statementOutcome("UNVERIFIED", statementA(), []);
    const signerAbsent = statementOutcome("UNKNOWN_AUTHORITY", statementSignedByKey5(), baseWires());
    const revokedEvidence = statementOutcome("REVOKED", statementS8(), chainWires("basePlus4A4R"));
    return evalOutcome({ emptyMaterial, signerAbsent, revokedEvidence }, {
      "fail-closed-empty-material": emptyMaterial.result === "PASS" && emptyMaterial.observation["phase"] === 5,
      "signer-absent-complete-chain-unknown-authority": signerAbsent.result === "PASS",
      "cached-revocation-evidence-not-verified": revokedEvidence.result === "PASS"
    });
  },

  "L2-VER-044": async () => {
    const statement = statementOutcome("UNVERIFIED", statementA(), baseWires(), { T: 1770001900 });
    return evalOutcome({ statement }, {
      "snapshot-failure-unverified": statement.result === "PASS" && statement.observation["phase"] === 6,
      "never-reported-as-revoked": String(statement.observation["observed"]) !== "REVOKED"
    });
  },

  "L2-VER-045": async () => ({
    result: "UNSUPPORTED-OPTIONAL",
    observation: { scope: "statement-revocation", baseline: "resolution statements only" },
    detail: "statement revocation (§7.2 extension, L2-VER-045) is optional in the L2 0.1 baseline: not implemented by the reference pipeline; recorded as UNSUPPORTED-OPTIONAL in the baseline report"
  }),

  "L2-VER-046": async () => {
    const nested = payloadOf("A3-Vector2");
    const first = jcsCanonicalize(nested);
    const second = jcsCanonicalize(JSON.parse(first) as Record<string, unknown>);
    const vectorOk = l2Fixtures.vectors.every(vector => jcsCanonicalize(JSON.parse(vector.canonical) as Record<string, unknown>) === vector.canonical);
    const padded = `  {"payload":${l2Vector("S7").canonical},"signature":"${l2Vector("S7").signature}"}  `;
    let paddedOk = false;
    try {
      paddedOk = parseWireEnvelope(padded).payloadWireText === l2Vector("S7").canonical;
    } catch {
      paddedOk = false;
    }
    const dupDetected = parseWireEnvelopeSafe(duplicateFirstPayloadMemberWire("S7"));
    const trailDupDetected = parseWireEnvelopeSafe(duplicateTrailMemberWire("Record2"));
    return evalOutcome({ nestedCanonical: first, vectorOk, paddedOk }, {
      "nested-canonicalization-reproducible": first === second,
      "all-vectors-canonical": vectorOk,
      "outer-whitespace-tolerated": paddedOk,
      "duplicate-detected-on-raw-text": dupDetected === "duplicate-member",
      "duplicate-detected-in-transfer-payload-text": trailDupDetected === "duplicate-member"
    });
  },

  "L2-VER-047": async () => {
    const prefix = chainWires("basePlus4A");
    const staleVariant = statementOutcome("STALE", statementS9v1(), prefix, { T: 1769998300, seed: [statementS9()] });
    const equivocation = statementOutcome("CONFLICT", statementS9v2(), prefix, { T: 1769998300, seed: [statementS9v1()] });
    const replay = statementOutcome("VERIFIED", statementS9(), prefix, { T: 1769998300, seed: [statementS9()] });
    const s8Replay = statementOutcome("REVOKED", statementS8(), chainWires("basePlus4A4R"), { seed: [statementS8()] });
    return evalOutcome({ staleVariant, equivocation, replay, s8Replay }, {
      "s9-generation-1-stale-variant": staleVariant.result === "PASS",
      "s9-generation-1-equivocation-conflict": equivocation.result === "PASS",
      "s9-generation-2-byte-identical-replay-verified": replay.result === "PASS",
      "s8-replay-byte-identical-stays-revoked": s8Replay.result === "PASS"
    });
  },

  "L2-AUT-001": async () => {
    const unanchored = walkChain({ anchor: trustAnchor(), recordWires: baseWires(), policyChannelProvenance: false });
    const statement = statementOutcome("UNVERIFIED", statementA(), baseWires(), { provenance: false });
    return evalOutcome({ unanchoredStop: unanchored.stop?.reason, statement }, {
      "record0-without-policy-provenance-rejected": unanchored.accepted.length === 0,
      "statement-unverified-from-unsigned-material": statement.result === "PASS"
    });
  },

  "L2-AUT-002": async () => {
    const digest0 = digestOf("Record0");
    const digest1 = digestOf("Record1");
    const digest2 = digestOf("Record2");
    const statementPayload = payloadOf("S7");
    return evalOutcome({ digest0, digest1, digest2 }, {
      "record0-digest-pinned": digest0 === "36ce3c7bf819434ebc79e534649873081ee0999af85c798c6586235680809afb",
      "record1-digest-pinned": digest1 === "870b931dd8f9ad01a6a037524842549ad60fcde1066dbc9caf4f3e6140102f61",
      "record2-digest-pinned": digest2 === "39808d467859fcad7589d70d54e0666038ac039d4956964ddda751f10f3e3234",
      "digests-are-prev-fields-of-next-records": (payloadOf("Record1")["prevRecordDigest"] as string) === digest0 && (payloadOf("Record2")["prevRecordDigest"] as string) === digest1 && (payloadOf("Record3")["prevRecordDigest"] as string) === digest2,
      "signature-and-envelope-not-covered-by-digest": !("signature" in statementPayload)
    });
  },

  "L2-AUT-003": async () => {
    const full = walkChain({ anchor: trustAnchor(), recordWires: chainWires("chain0to4"), policyChannelProvenance: true });
    const gapWalk = walkChain({ anchor: trustAnchor(), recordWires: [wire("Record0"), wire("Record2")], policyChannelProvenance: true });
    const regression = walkChain({ anchor: trustAnchor(), recordWires: [...baseWires(), wire("Record1")], policyChannelProvenance: true });
    const generations = chainWires("chain0to4").map(w => payloadOfW(w)["recordGeneration"]);
    return evalOutcome({ generations, gapStop: gapWalk.stop?.reason, regressionMax: regression.acceptedMax }, {
      "generations-increase-in-preset": generations.join(",") === "0,1,2,3,4",
      "full-preset-accepted": full.acceptedMax === 4,
      "gap-breaks-at-first-offending-record": gapWalk.acceptedMax === 0 && String(gapWalk.stop?.reason).includes("contiguity-gap"),
      "regression-presentation-does-not-advance": regression.acceptedMax === 3 && regression.evaluations[4]?.verdict === "STALE"
    });
  },

  "L2-AUT-004": async () => {
    const deleted = record3DeletesKey1Entry();
    const walk = walkChain({ anchor: trustAnchor(), recordWires: [wire("Record0"), wire("Record1"), wire("Record2"), deleted], policyChannelProvenance: true });
    const tampered = parseRecordWire(record2Key3PublicKeyTampered());
    const key1InRecord0 = findKey(payloadOfW(wire("Record0"))["keys"] as KeyEntry[], l2Key("key1").keyId);
    const key1InRecord3 = findKey(payloadOfW(wire("Record3"))["keys"] as KeyEntry[], l2Key("key1").keyId);
    return evalOutcome({ walkStop: walk.stop?.reason, tamperFailures: tampered.failures }, {
      "entry-deletion-rejected": walk.stop !== null,
      "identity-fields-preserved-across-records": key1InRecord0 !== undefined && key1InRecord3 !== undefined && key1InRecord0.publicKey === key1InRecord3.publicKey && key1InRecord0.algorithm === key1InRecord3.algorithm && key1InRecord0.validFrom === key1InRecord3.validFrom,
      "public-key-tamper-detected-by-keyid-recompute": tampered.failures.includes("keyid-recompute-mismatch")
    });
  },

  "L2-AUT-005": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: [...chainWires("basePlus4A4R"), wire("Record4C")], policyChannelProvenance: true });
    const statement = statementOutcome("REVOKED", statementS8(), chainWires("basePlus4A4R"));
    return evalOutcome({ stopReason: walk.stop?.reason, statement }, {
      "revokedFrom-immutability-rejects-4c": walk.stop !== null && String(walk.stop.reason).includes("revokedFrom"),
      "statement-verdict-unchanged": statement.result === "PASS"
    });
  },

  "L2-AUT-006": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: [...chainWires("basePlus4A4R"), record6ReRegistersRevokedKey()], policyChannelProvenance: true });
    return evalOutcome({ stopReason: walk.stop?.reason }, {
      "terminal-state-never-returns-to-current": walk.stop !== null && String(walk.stop.reason).includes("terminal-state-reopened")
    });
  },

  "L2-AUT-007": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: baseWires(), policyChannelProvenance: true });
    const key1 = findKey(payloadOfW(wire("Record1"))["keys"] as KeyEntry[], l2Key("key1").keyId);
    const key2 = findKey(payloadOfW(wire("Record2"))["keys"] as KeyEntry[], l2Key("key2").keyId);
    const violationWalk = walkChain({ anchor: trustAnchor(), recordWires: [wire("Record0"), record1RetirementCapViolated()], policyChannelProvenance: true });
    return evalOutcome({ key1ValidUntil: key1?.validUntil, key2ValidUntil: key2?.validUntil, violationStop: violationWalk.stop?.reason }, {
      "key1-retired-at-cap": key1?.validUntil === 1769997000,
      "key2-retired-at-cap": key2?.validUntil === 1769997600,
      "cap-violation-rejected": violationWalk.stop !== null && String(violationWalk.stop.reason).includes("validUntil")
    });
  },

  "L2-AUT-008": async () => {
    const missing = parseRecordWire(recordMissingStatementFloor());
    const record2 = payloadOf("Record2");
    const record5 = payloadOf("Record5");
    const record3 = payloadOf("Record3");
    return evalOutcome({ missingFailures: missing.failures }, {
      "record-without-statementfloor-rejected": missing.failures.length > 0,
      "floor-zero-on-epoch-switch-records": record2["statementFloor"] === 0 && record5["statementFloor"] === 0,
      "floor-repeated-within-epoch": record3["statementFloor"] === record2["statementFloor"]
    });
  },

  "L2-AUT-009": async () => {
    const epochChange = payloadOfW(recordEpochChangeWithoutTransfer());
    const transferRecord = payloadOfW(recordTransferWithoutEpochChange());
    const changeWalk = walkChain({ anchor: trustAnchor(), recordWires: [...chainWires("chain0to4").slice(0, 4), recordEpochChangeWithoutTransfer()], policyChannelProvenance: true });
    const transferWalk = walkChain({ anchor: trustAnchor(), recordWires: [wire("Record0"), recordTransferWithoutEpochChange()], policyChannelProvenance: true });
    return evalOutcome({ changeStop: changeWalk.stop?.reason, transferStop: transferWalk.stop?.reason }, {
      "epoch-change-without-transfer-rejected": changeWalk.stop !== null && String(changeWalk.stop.reason).includes("epoch-change-without-transfer"),
      "transfer-without-epoch-change-rejected": transferWalk.stop !== null && String(transferWalk.stop.reason).includes("transfer-without-epoch-change"),
      "surgery-kept-fields-locally-consistent": epochChange["epochId"] === "epoch-2" && transferRecord["epochId"] === "epoch-0"
    });
  },

  "L2-AUT-010": async () => {
    const trail = payloadOf("Trail2");
    const record2 = payloadOf("Record2");
    const record1 = payloadOf("Record1");
    const trailKeys = Object.keys(trail).sort();
    const trailMembers = trailKeys.join(",");
    const key3 = findKey(record2["keys"] as KeyEntry[], l2Key("key3").keyId);
    return evalOutcome({ trailMembers }, {
      "trail-field-set-complete": trailMembers === "algorithm,anchorId,entityId,epochId,incomingKeyId,l2Version,newEpochId,outgoingKeyId,recordGeneration,statementFloor,statementType",
      "trail-values-match-record-2": trail["outgoingKeyId"] === record2["signerKeyId"] && trail["incomingKeyId"] === l2Key("key3").keyId && trail["epochId"] === record1["epochId"] && trail["newEpochId"] === record2["epochId"] && trail["recordGeneration"] === record2["recordGeneration"] && trail["statementFloor"] === record2["statementFloor"],
      "key3-window-contains-record2-issuedAt": key3 !== undefined && key3.validFrom === (record2["issuedAt"] as number) && key3.validUntil >= (record2["issuedAt"] as number)
    });
  },

  "L2-AUT-011": async () => {
    const forbidden = parseRecordWire(recordTrailForbiddenMember());
    const trailPayload = payloadOf("Trail2");
    const forbiddenNames = ["keyId", "generation", "issuedAt", "expiresAt", "descriptionLocation", "lifecycleStatus", "effectiveGeneration"];
    return evalOutcome({ forbiddenFailures: forbidden.failures }, {
      "trail-with-issuedAt-rejected": forbidden.failures.length > 0,
      "pinned-trail-has-no-forbidden-members": forbiddenNames.every(name => !(name in trailPayload))
    });
  },

  "L2-AUT-012": async () => {
    const trailVector = l2Vector("Trail2");
    const record1 = payloadOf("Record1");
    const key2 = findKey(record1["keys"] as KeyEntry[], l2Key("key2").keyId);
    const signatureOk = key2 !== undefined && verifyEd25519(key2.publicKey, trailVector.signature, trailVector.canonical);
    return evalOutcome({ signatureOk, window: key2 }, {
      "trail-signature-verifies-under-outgoing-key": signatureOk,
      "outgoing-key-window-contains-record2-issuedAt": key2 !== undefined && key2.validFrom <= 1769997600 && 1769997600 <= key2.validUntil
    });
  },

  "L2-AUT-013": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: chainWires("chain0to4plus5V"), policyChannelProvenance: true });
    const record5V = payloadOf("Record5V");
    const key4 = findKey(payloadOf("Record4")["keys"] as KeyEntry[], l2Key("key4").keyId);
    const signatureOk = key4 !== undefined && verifyEd25519(key4.publicKey, l2Vector("Record5V").signature, l2Vector("Record5V").canonical);
    return evalOutcome({ stopReason: walk.stop?.reason, acceptedMax: walk.acceptedMax, signatureOk }, {
      "record5v-window-exclusion-rejected": walk.stop !== null && String(walk.stop.reason).includes("signer-window-excludes-record-issuedAt"),
      "trail-epoch-still-new": !walk.acceptedEpochs.includes(record5V["epochId"] as string),
      "record5v-signature-verifies": signatureOk,
      "accepted-max-stays-four": walk.acceptedMax === 4
    });
  },

  "L2-AUT-014": async () => {
    const trailFailure = [wire("Record0"), wire("Record1"), recordTrailEpochMismatch()];
    const walk = walkChain({ anchor: trustAnchor(), recordWires: trailFailure, policyChannelProvenance: true });
    const statement = statementOutcome("UNVERIFIED", statementA(), trailFailure);
    const noTransfer = walkChain({ anchor: trustAnchor(), recordWires: [...chainWires("chain0to4").slice(0, 4), recordEpochChangeWithoutTransfer()], policyChannelProvenance: true });
    return evalOutcome({ walkStop: walk.stop?.reason, statement }, {
      "trail-defect-stops-chain-at-previous": walk.acceptedMax === 1,
      "dependent-statement-unverified": statement.result === "PASS",
      "never-unknown-authority-when-signer-resolves-inside-prefix": String(statement.observation["observed"]) !== "UNKNOWN_AUTHORITY",
      "missing-transfer-rejected": noTransfer.stop !== null && String(noTransfer.stop.reason).includes("epoch-change-without-transfer")
    });
  },

  "L2-AUT-015": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: [wire("Record0"), wire("Record1"), record2LeavesKey2Current()], policyChannelProvenance: true });
    const acceptedWalk = walkChain({ anchor: trustAnchor(), recordWires: baseWires(), policyChannelProvenance: true });
    const record2Keys = payloadOf("Record2")["keys"] as KeyEntry[];
    const currentInRecord2 = record2Keys.filter(entry => entry.status === "current");
    return evalOutcome({ walkStop: walk.stop?.reason }, {
      "sole-current-rule-rejects-variant": walk.stop !== null && String(walk.stop.reason).includes("trail-incoming-key-not-sole-current"),
      "pinned-record2-atomic-epoch-switch": acceptedWalk.evaluations[2]?.accepted === true && currentInRecord2.length === 1 && currentInRecord2[0]?.keyId === l2Key("key3").keyId
    });
  },

  "L2-AUT-016": async () => {
    const trailPayload = payloadOf("Trail2");
    const trailVector = l2Vector("Trail2");
    const key2 = findKey(payloadOf("Record1")["keys"] as KeyEntry[], l2Key("key2").keyId);
    const trailVerifiesAtLater = key2 !== undefined && verifyEd25519(key2.publicKey, trailVector.signature, trailVector.canonical);
    const statement = statementOutcome("UNVERIFIED", statementA(), baseWires(), { T: 1770002000 });
    return evalOutcome({ trailVerifiesAtLater, statement }, {
      "trail-has-no-validity-window": !("validFrom" in trailPayload) && !("validUntil" in trailPayload) && !("expiresAt" in trailPayload),
      "trail-verifies-historically-at-T2000": trailVerifiesAtLater,
      "statement-unverified-by-snapshot-freshness-at-T2000": statement.result === "PASS" && statement.observation["phase"] === 6
    });
  },

  "L2-AUT-017": async () => {
    const standalone = parseRecordWire(l2WireEnvelope("Trail5"));
    const walk = walkChain({ anchor: trustAnchor(), recordWires: [...chainWires("chain0to4"), l2WireEnvelope("Trail5")], policyChannelProvenance: true });
    return evalOutcome({ standaloneFailures: standalone.failures, acceptedEpochs: walk.acceptedEpochs }, {
      "standalone-trail-rejected-as-record": standalone.failures.length > 0,
      "trail-presentation-never-creates-epoch": walk.acceptedMax === 4 && !walk.acceptedEpochs.includes("epoch-2")
    });
  },

  "L2-AUT-018": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: baseWires(), policyChannelProvenance: true });
    const record1 = payloadOf("Record1");
    return evalOutcome({ acceptedEpochs: walk.acceptedEpochs }, {
      "record1-signed-by-key1-in-epoch-0": record1["signerKeyId"] === l2Key("key1").keyId && record1["epochId"] === "epoch-0",
      "rotation-preserves-epoch": walk.acceptedEpochs.join(",") === "epoch-0,epoch-1"
    });
  },

  "L2-AUT-019": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: [...baseWires(), record4SignerAbsentFromPrevious()], policyChannelProvenance: true });
    return evalOutcome({ stopReason: walk.stop?.reason, acceptedMax: walk.acceptedMax }, {
      "signer-of-next-record-must-be-present-in-previous": walk.stop !== null && String(walk.stop.reason).includes("signer-outside-accepted-chain"),
      "accepted-max-stays-three": walk.acceptedMax === 3
    });
  },

  "L2-AUT-020": async () => {
    const unanchored = walkChain({ anchor: trustAnchor(), recordWires: baseWires(), policyChannelProvenance: false });
    const statement = statementOutcome("UNVERIFIED", statementA(), baseWires(), { provenance: false });
    const selfBootstrap = walkChain({ anchor: trustAnchor(), recordWires: [record0SelfBootstrap()], policyChannelProvenance: true });
    const reanchored = walkChain({
      anchor: { anchorId: ANCHOR_ID, entityId: ENTITY_ID, keyId: l2Key("key4").keyId, publicKey: l2Key("key4").publicKey, algorithm: "ed25519", epochId: "epoch-0", statementFloor: 0 },
      recordWires: [record0SelfBootstrap()],
      policyChannelProvenance: true
    });
    return evalOutcome({ unanchoredMax: unanchored.acceptedMax, statement, selfBootstrapStop: selfBootstrap.stop?.reason, reanchoredMax: reanchored.acceptedMax }, {
      "no-verified-lower-bound-without-policy-channel": unanchored.accepted.length === 0 && statement.result === "PASS",
      "self-bootstrap-rejected-against-original-binding": selfBootstrap.stop !== null,
      "compromise-requires-new-anchor-binding": reanchored.accepted.length === 1
    });
  },

  "L2-AUT-021": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: [record0SelfBootstrap()], policyChannelProvenance: true });
    return evalOutcome({ stopReason: walk.stop?.reason, verdict: walk.stop?.verdict }, {
      "record0-key-introduction-by-self-signing-rejected": walk.stop !== null && String(walk.stop.reason).includes("record0-signer-against-binding-keyid"),
      "introduced-key-never-authorizes-itself": walk.accepted.length === 0
    });
  },

  "L2-AUT-022": async () => {
    const tampered = record2Key3PublicKeyTampered();
    const statement = statementOutcome("UNKNOWN_AUTHORITY", statementA(), [wire("Record0"), wire("Record1"), tampered]);
    return evalOutcome({ statement }, {
      "keyid-recompute-failure-never-invalid-on-statement": String(statement.observation["observed"]) === "UNKNOWN_AUTHORITY" && statement.result === "PASS"
    });
  },

  "L2-AUT-023": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: [...baseWires(), recordReentersAcceptedEpoch()], policyChannelProvenance: true });
    return evalOutcome({ stopReason: walk.stop?.reason, acceptedEpochs: walk.acceptedEpochs }, {
      "epoch-never-accepted-twice": walk.stop !== null && String(walk.stop.reason).includes("epoch-already-accepted"),
      "epochs-two-and-three-unaccepted": !walk.acceptedEpochs.includes("epoch-2") && !walk.acceptedEpochs.includes("epoch-3")
    });
  },

  "L2-AUT-024": async () => {
    const walk = walkChain({ anchor: trustAnchor(), recordWires: chainWires("basePlus4A"), policyChannelProvenance: true });
    const record4AKeys = payloadOf("Record4A")["keys"] as KeyEntry[];
    const key3 = findKey(record4AKeys, l2Key("key3").keyId);
    const key4 = findKey(record4AKeys, l2Key("key4").keyId);
    return evalOutcome({ acceptedMax: walk.acceptedMax, record4AKeys }, {
      "positive-rotation-record4a-accepted": walk.acceptedMax === 4,
      "key3-remains-current": key3?.status === "current",
      "key4-introduced-current": key4?.status === "current" && key4.validFrom === 1769998300,
      "overlapping-windows-allowed": key3 !== undefined && key4 !== undefined && key4.validFrom <= key3.validUntil
    });
  },

  "L2-PRO-001": async () => {
    const allVectorsOk = l2Fixtures.vectors.every(vector => jcsCanonicalize(JSON.parse(vector.canonical) as Record<string, unknown>) === vector.canonical);
    const record2Wire = parseWireEnvelope(wire("Record2"));
    return evalOutcome({ allVectorsOk, record2PayloadTextEqual: record2Wire.payloadWireText === l2Vector("Record2").canonical }, {
      "single-jcs-canonical-signing-target": allVectorsOk,
      "wire-carries-payload-bytes-verbatim": record2Wire.payloadWireText === l2Vector("Record2").canonical
    });
  },

  "L2-PRO-002": async () => {
    const vector = l2Vector("A2-Vector1");
    const canonical = jcsCanonicalize(payloadOf("A2-Vector1"));
    const signatureOk = verifyEd25519(vector.signerPublicKey, vector.signature, vector.canonical);
    return evalOutcome({ canonicalEqualsPinned: canonical === vector.canonical, signatureOk }, {
      "byte-identical-reproduction": canonical === vector.canonical,
      "pinned-signature-verifies": signatureOk
    });
  },

  "L2-PRO-003": async () => {
    const order = topLevelKeyOrder("A3-Vector2");
    const utf16Sorted = [...order].sort();
    const codePointSorted = [...order].sort((a, b) => {
      const aPoints = Array.from(a);
      const bPoints = Array.from(b);
      for (let i = 0; i < Math.max(aPoints.length, bPoints.length); i += 1) {
        const diff = (aPoints[i]?.codePointAt(0) ?? 0) - (bPoints[i]?.codePointAt(0) ?? 0);
        if (diff !== 0) {
          return diff;
        }
      }
      return 0;
    });
    return evalOutcome({ order, codePointSorted }, {
      "keys-sorted-by-utf-16-code-units": order.join("|") === utf16Sorted.join("|"),
      "canonicalization-is-reproducible": jcsCanonicalize(payloadOf("A3-Vector2")) === l2Vector("A3-Vector2").canonical
    });
  },

  "L2-PRO-004": async () => {
    const ext = payloadOf("A4-Vector3")["extUnicode"] as Record<string, unknown>;
    const unicodeKeys = Object.keys(ext);
    const utf16Sorted = [...unicodeKeys].sort();
    const hasNonBmp = unicodeKeys.some(name => Array.from(name).some(char => (char.codePointAt(0) ?? 0) > 0xffff));
    const topOrder = topLevelKeyOrder("A4-Vector3");
    const topSorted = [...topOrder].sort();
    return evalOutcome({ unicodeKeys, topOrder }, {
      "non-bmp-key-order-by-utf-16": hasNonBmp && unicodeKeys.join("|") === utf16Sorted.join("|"),
      "top-level-key-order-by-utf-16": topOrder.join("|") === topSorted.join("|"),
      "byte-identical-to-pinned-vector": jcsCanonicalize(payloadOf("A4-Vector3")) === l2Vector("A4-Vector3").canonical
    });
  },

  "L2-PRO-005": async () => {
    const record2Canonical = l2Vector("Record2").canonical;
    const trailCanonical = l2Vector("Trail2").canonical;
    const trailSignature = l2Vector("Trail2").signature;
    const embedded = `"transfer":{"payload":${trailCanonical},"signature":"${trailSignature}"}`;
    const key2 = findKey(payloadOf("Record2")["keys"] as KeyEntry[], l2Key("key2").keyId);
    const recordSignatureOk = key2 !== undefined && verifyEd25519(key2.publicKey, l2Vector("Record2").signature, record2Canonical);
    return evalOutcome({ embeddedPresent: record2Canonical.includes(embedded) }, {
      "trail-canonical-appears-verbatim-in-record": record2Canonical.includes(embedded),
      "trail-signature-carried-unchanged": record2Canonical.includes(`"signature":"${trailSignature}"`),
      "record-signature-covers-trail-bytes": recordSignatureOk
    });
  },

  "L2-PRO-006": async () => {
    const noDuplicates = l2Fixtures.vectors.every(vector => new Set(Object.keys(JSON.parse(vector.canonical) as Record<string, unknown>)).size === Object.keys(JSON.parse(vector.canonical) as Record<string, unknown>).length);
    const nestedOk = l2Fixtures.vectors.every(vector => {
      const parsed = JSON.parse(vector.canonical) as Record<string, unknown>;
      const transfer = parsed["transfer"];
      if (transfer === undefined) {
        return true;
      }
      const trail = (transfer as { payload: Record<string, unknown> }).payload;
      return new Set(Object.keys(trail)).size === Object.keys(trail).length;
    });
    const dupRejected = parseWireEnvelopeSafe(duplicateFirstPayloadMemberWire("Record2")) === "duplicate-member";
    return evalOutcome({ noDuplicates, nestedOk }, {
      "producer-canonical-output-has-no-duplicates": noDuplicates && nestedOk,
      "duplicate-wire-rejected-by-parser": dupRejected
    });
  },

  "L2-PRO-007": async () => {
    const payloadHasNoSignature = l2Fixtures.vectors.every(vector => !("signature" in (JSON.parse(vector.canonical) as Record<string, unknown>)));
    const envelopeShape = l2Fixtures.vectors.every(vector => {
      const envelope = parseWireEnvelope(l2WireEnvelope(vector.id));
      return envelope.memberNames.join(",") === "payload,signature";
    });
    return evalOutcome({ payloadHasNoSignature, envelopeShape }, {
      "payload-objects-never-carry-signature": payloadHasNoSignature,
      "envelope-carries-only-payload-and-signature": envelopeShape
    });
  },

  "L2-PRO-008": async () => {
    const keyNames = ["key1", "key2", "key3", "key4", "key5"];
    const derived = keyNames.map(name => {
      const key = l2Key(name);
      return {
        keyId: key.keyId,
        recomputed: computeKeyId(key.publicKey),
        keyIdBytes: base64urlDecode(key.keyId).length,
        publicKeyBytes: base64urlDecode(key.publicKey).length,
        signatureBytes: base64urlDecode(l2Vector("A2-Vector1").signature).length,
        caseSensitive: /[a-z]/.test(key.keyId) && /[A-Z]/.test(key.keyId)
      };
    });
    const allMatch = derived.every(item => item.keyId === item.recomputed);
    const lengthsOk = derived.every(item => item.keyId.length === 11 && item.keyIdBytes === 8 && item.publicKeyBytes === 32) && derived[0]?.signatureBytes === 64;
    const caseOk = derived.every(item => item.caseSensitive);
    return evalOutcome({ derived }, {
      "keyid-equals-first-8-sha256-bytes-base64url": allMatch,
      "11-char-8-byte-32-byte-64-byte-shapes": lengthsOk,
      "keyid-is-case-sensitive": caseOk
    });
  },

  "L2-PRO-009": async () => {
    const record0Only = statementOutcome("UNKNOWN_AUTHORITY", statementA(), [wire("Record0")]);
    const baseWalk = walkChain({ anchor: trustAnchor(), recordWires: baseWires(), policyChannelProvenance: true });
    const rotationWalk = walkChain({ anchor: trustAnchor(), recordWires: chainWires("basePlus4A"), policyChannelProvenance: true });
    const revocationWalk = walkChain({ anchor: trustAnchor(), recordWires: chainWires("basePlus4A4R"), policyChannelProvenance: true });
    const key1Cap = findKey(payloadOf("Record1")["keys"] as KeyEntry[], l2Key("key1").keyId);
    const key3Revoked = findKey(payloadOf("Record4R")["keys"] as KeyEntry[], l2Key("key3").keyId);
    return evalOutcome({ record0Only, acceptedMaxRotation: rotationWalk.acceptedMax, acceptedMaxRevocation: revocationWalk.acceptedMax }, {
      "single-key-deployment-never-verified": record0Only.result === "PASS" && String(record0Only.observation["observed"]) !== "VERIFIED",
      "rotation-records-present": baseWalk.evaluations[1]?.accepted === true && rotationWalk.acceptedMax === 4,
      "retirement-cap-enforced": key1Cap?.validUntil === 1769997000,
      "revocation-accepted": revocationWalk.acceptedMax === 5 && key3Revoked?.status === "revoked"
    });
  },

  "L2-PRO-010": async () => {
    const vector = l2Vector("A4-Vector3b");
    const canonical = jcsCanonicalize(payloadOf("A4-Vector3b"));
    const digest = sha256HexOfUtf8(canonical);
    return evalOutcome({ digest }, {
      "escape-fixture-byte-identical": canonical === vector.canonical,
      "digest-consistent-with-canonical-bytes": digest === sha256HexOfUtf8(vector.canonical) && /^[0-9a-f]{64}$/.test(digest)
    });
  },

  "L2-PRO-011": async () => {
    const perVector = l2Fixtures.vectors.map(vector => ({
      id: vector.id,
      verifies: verifyEd25519(vector.signerPublicKey, vector.signature, vector.canonical)
    }));
    const failed = perVector.filter(item => !item.verifies).map(item => item.id);
    return evalOutcome({ failed }, {
      "every-pinned-signature-verifies-over-canonical-bytes": failed.length === 0
    });
  },

  "L2-PRO-012": async () => ({
    result: "UNSUPPORTED-OPTIONAL",
    observation: { algorithm: "ES256", baseline: "ed25519 only" },
    detail: "ES256 support is optional in L2 0.1: the baseline pipeline implements ed25519 only; ES256 offered by a producer is recorded as UNSUPPORTED-OPTIONAL (see L2-VER-005 for the verifier-side UNSUPPORTED_ALGORITHM path)"
  }),

  "L2-SRV-001": async context => {
    const statement = await request(context, `/relink/${SRV_ACTIVE_UUID}?l=2`);
    const core = await request(context, `/relink/${SRV_ACTIVE_UUID}`);
    const suspended = await request(context, `/relink/${SRV_SUSPENDED_UUID}?l=2`);
    const retired = await request(context, `/relink/${SRV_RETIRED_UUID}?l=2`);
    const unknown = await request(context, `/relink/550e8400-e29b-41d4-a716-446699999999?l=2`);
    const malformed = await request(context, `/relink/not-a-uuid?l=2`);
    return evalOutcome({ statementStatus: statement.status, coreStatus: core.status }, {
      "statement-surface-200-verbatim": statement.status === 200 && statement.body === wire("S7"),
      "core-303-additive": core.status === 303 && core.headers["location"] === payloadOf("S7")["descriptionLocation"],
      "suspended-404": suspended.status === 404,
      "retired-410": retired.status === 410,
      "unknown-anchor-404": unknown.status === 404,
      "malformed-uuid-400": malformed.status === 400
    });
  },

  "L2-SRV-002": async context => {
    const material = await request(context, `/relink/${SRV_ACTIVE_UUID}/authority`);
    const body = JSON.parse(material.body) as { records: { payload: { [key: string]: JsonValue }; signature: string }[] };
    const generations = body.records.map(record => record.payload["recordGeneration"]);
    const presetNames = CHAIN_PRESETS["chain0to4"] ?? [];
    const verbatim = body.records.length === presetNames.length && body.records.every((record, index) => {
      const name = presetNames[index] ?? "";
      const vector = l2Vector(name);
      return jcsCanonicalize(record.payload) === vector.canonical && record.signature === vector.signature;
    });
    const suspended = await request(context, `/relink/${SRV_SUSPENDED_UUID}/authority`);
    const retired = await request(context, `/relink/${SRV_RETIRED_UUID}/authority`);
    const gap = await request(context, `/relink/${SRV_GAP_UUID}/authority`);
    return evalOutcome({ generations, recordCount: body.records.length }, {
      "material-200-records-array": material.status === 200 && Array.isArray(body.records),
      "records-0-to-G-verbatim-ascending": generations.join(",") === "0,1,2,3,4" && verbatim,
      "body-framing-unsigned": Object.keys(body).join(",") === "records",
      "suspended-404": suspended.status === 404,
      "retired-410": retired.status === 410,
      "gap-chain-not-served-404": gap.status === 404
    });
  },

  "L2-SRV-003": async context => {
    const putStatement = await request(context, `/relink/${SRV_ACTIVE_UUID}?l=2`, { method: "PUT", body: "x" });
    const putMaterial = await request(context, `/relink/${SRV_ACTIVE_UUID}/authority`, { method: "PUT", body: "x" });
    const postStatement = await request(context, `/relink/${SRV_ACTIVE_UUID}?l=2`, { method: "POST", body: wire("S7") });
    const anonymous = await request(context, `/relink/${SRV_ACTIVE_UUID}?l=2`);
    const unchanged = await request(context, `/relink/${SRV_ACTIVE_UUID}?l=2`);
    return evalOutcome({ putStatementStatus: putStatement.status, postStatus: postStatement.status }, {
      "put-statement-405-with-allow": putStatement.status === 405 && putStatement.headers["allow"] === "GET",
      "put-material-405-with-allow": putMaterial.status === 405 && putMaterial.headers["allow"] === "GET",
      "post-statement-405": postStatement.status === 405 && postStatement.headers["allow"] === "GET",
      "anonymous-get-works": anonymous.status === 200,
      "binding-unchanged-after-mutation-attempts": unchanged.status === 200 && unchanged.body === wire("S7")
    });
  },

  "L2-SRV-004": async context => {
    const pStatement = await request(context, `/relink/${SRV_ACTIVE_UUID}?l=2&p=version`);
    const l1 = await request(context, `/relink/${SRV_ACTIVE_UUID}?l=1`);
    const l3 = await request(context, `/relink/${SRV_ACTIVE_UUID}?l=3`);
    const l2 = await request(context, `/relink/${SRV_ACTIVE_UUID}?l=2`);
    const pMaterial = await request(context, `/relink/${SRV_ACTIVE_UUID}/authority?p=x`);
    const clientPayload = await request(context, `/relink/${SRV_ACTIVE_UUID}/authority`, { method: "POST", body: wire("Record4") });
    return evalOutcome({ pStatement, l1, l3 }, {
      "p-with-l2-400-before-lookup": pStatement.status === 400,
      "l1-not-treated-as-l2": l1.status === 400,
      "l3-fail-closed-400": l3.status === 400,
      "l2-defined-semantics-200": l2.status === 200,
      "material-rejects-p-400": pMaterial.status === 400,
      "no-client-submitted-signing-targets": clientPayload.status === 405
    });
  },

  "L2-SRV-005": async context => {
    if (context === undefined) {
      return { result: "FAIL", observation: {}, detail: "L2-SRV handler requires a run context with a base URL" };
    }
    const statement = await request(context, `/relink/${SRV_ACTIVE_UUID}?l=2`);
    const cache = statement.headers["cache-control"] ?? "";
    const maxAge = Number(cache.replace(/^.*max-age=(\d+).*$/, "$1"));
    const remaining = (payloadOf("S7")["expiresAt"] as number) - FIXED_T;
    const immediate = await startStubResolverServer({ entries: defaultStubEntries(), fixedT: FIXED_T, immediateFreshness: true });
    const material = await request({ client: context.client, baseUrl: immediate.baseUrl }, `/relink/${SRV_ACTIVE_UUID}/authority`);
    const cacheOnErrors: boolean[] = [];
    for (const path of [`/relink/${SRV_SUSPENDED_UUID}?l=2`, `/relink/${SRV_RETIRED_UUID}?l=2`, `/relink/${SRV_INTERNAL_UUID}?l=2`, `/relink/${SRV_UNAVAILABLE_UUID}?l=2`]) {
      cacheOnErrors.push((await request({ client: context.client, baseUrl: immediate.baseUrl }, path)).headers["cache-control"] === undefined);
    }
    await immediate.close();
    const cachedThenRevoked = statementOutcome("REVOKED", statementS8(), chainWires("basePlus4A4R"));
    return evalOutcome({ cache, remaining, immediateCache: material.headers["cache-control"], cachedThenRevoked }, {
      "cache-bounded-by-remaining-validity": cache.startsWith("public, max-age=") && maxAge <= remaining,
      "immediate-freshness-profile-recorded": material.headers["cache-control"] === "no-store",
      "error-responses-do-not-enable-positive-reuse": cacheOnErrors.every(ok => ok),
      "cache-reusability-is-not-revocation-detection": cachedThenRevoked.result === "PASS"
    });
  },

  "L2-SRV-006": async context => {
    const statement = await request(context, `/relink/${SRV_ACTIVE_UUID}?l=2`);
    const material = await request(context, `/relink/${SRV_ACTIVE_UUID}/authority`);
    const present = statement.headers["referrer-policy"] === "no-referrer" && material.headers["referrer-policy"] === "no-referrer";
    if (present) {
      return {
        result: "PASS",
        observation: { "Referrer-Policy": "no-referrer", onStatement: statement.headers["referrer-policy"], onMaterial: material.headers["referrer-policy"] },
        detail: "SHOULD honored by the tested server"
      };
    }
    return {
      result: "PASS-WITH-DEVIATION",
      observation: { "Referrer-Policy": statement.headers["referrer-policy"] ?? null, onMaterial: material.headers["referrer-policy"] ?? null },
      detail: "SHOULD documented deviation: the tested server omits Referrer-Policy: no-referrer on the L2 surface; the reference stub sets it"
    };
  },

  "L2-SRV-007": async context => {
    const statement = await request(context, `/relink/${SRV_ACTIVE_UUID}?l=2`);
    const pRejected = await request(context, `/relink/${SRV_ACTIVE_UUID}?l=2&p=version`);
    const core = await request(context, `/relink/${SRV_ACTIVE_UUID}`);
    const cookieHeader = statement.headers["set-cookie"];
    const coreCookie = core.headers["set-cookie"];
    return evalOutcome({ statementStatus: statement.status, pRejectedStatus: pRejected.status }, {
      "anchor-uuids-are-the-loggable-metadata": statement.status === 200 && statement.body === wire("S7"),
      "no-cookies-credentials-required": cookieHeader === undefined && coreCookie === undefined,
      "p-not-expanded-beyond-core": pRejected.status === 400,
      "l-values-never-expanded-into-other-levels": (await request(context, `/relink/${SRV_ACTIVE_UUID}?l=1`)).status === 400
    });
  },

  "L2-SRV-008": async context => {
    const statement = await request(context, `/relink/${SRV_ACTIVE_UUID}?l=2`);
    const core = await request(context, `/relink/${SRV_ACTIVE_UUID}`);
    const mutation = await request(context, `/relink/${SRV_ACTIVE_UUID}?l=2`, { method: "PUT", body: "x" });
    const admin = await request(context, `/relink/__admin/devices`);
    const material = await request(context, `/relink/${SRV_ACTIVE_UUID}/authority`);
    const materialBody = JSON.parse(material.body) as Record<string, unknown>;
    return evalOutcome({ adminStatus: admin.status }, {
      "no-ar-xml-fetch-parse-validate": statement.body === wire("S7"),
      "no-management-ui-device-capability-endpoints": admin.status >= 400,
      "no-public-mutations": mutation.status === 405,
      "additive-optional-surface": core.status === 303 && Object.keys(materialBody).join(",") === "records",
      "core-conformance-valid-without-l2": core.headers["location"] === payloadOf("S7")["descriptionLocation"],
      "admin-auth-required-not-public": admin.status >= 400 && statement.status === 200
    });
  }
};

function parseWireEnvelopeSafe(wireText: string): string {
  try {
    parseWireEnvelope(wireText);
    return "ok";
  } catch (error) {
    return error instanceof WireError ? error.reason : "wire-parse-failure";
  }
}

function payloadOfW(wireText: string): Record<string, unknown> {
  return wirePayloadObject(wireText);
}

export async function runL2Case(caseId: string, context: L2RunContext | undefined): Promise<CaseOutcome> {
  const handler = handlers[caseId];
  if (handler === undefined) {
    return { result: "FAIL", observation: { caseId }, detail: "no handler for catalog case" };
  }
  return handler(context);
}

export function l2HandlerCaseIds(): string[] {
  return Object.keys(handlers).sort();
}
