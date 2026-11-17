// src/conformance/l2/scenarios.ts
// Fixture-derived L2 scenarios: the pinned Trust Anchor Binding, pinned Record/statement
// wires, and negative variants built by canonical-preserving string surgery on the pinned
// vectors, or by re-signing a mutated payload with the fixture seed (never re-signing a
// pinned vector itself).

import { l2Fixtures, l2Key, l2Vector, l2WireEnvelope } from "./fixtures/l2Fixtures.js";
import { jcsCanonicalize } from "./jcs.js";
import { signWithSeed, deriveSeedFromSeedString, publicKeyHexFromSeed } from "./ed25519.js";
import { sha256HexOfUtf8, computeKeyId } from "./keyId.js";
import { base64urlEncode } from "./base64url.js";
import type { KeyEntry } from "./model.js";
import type { TrustAnchorBinding } from "./chainWalk.js";

export const FIXED_T = l2Fixtures.timeT;
export const FIXED_W = l2Fixtures.freshnessWindowW;
export const ANCHOR_ID = l2Fixtures.anchorId;
export const ENTITY_ID = l2Fixtures.entityId;

export function trustAnchor(): TrustAnchorBinding {
  const key1 = l2Key("key1");
  return {
    anchorId: ANCHOR_ID,
    entityId: ENTITY_ID,
    keyId: key1.keyId,
    publicKey: key1.publicKey,
    algorithm: "ed25519",
    epochId: "epoch-0",
    statementFloor: 0
  };
}

export function wire(vectorId: string): string {
  return l2WireEnvelope(vectorId);
}

export function payloadOf(vectorId: string): Record<string, unknown> {
  return JSON.parse(l2Vector(vectorId).canonical) as Record<string, unknown>;
}

export function digestOf(vectorId: string): string {
  return sha256HexOfUtf8(l2Vector(vectorId).canonical);
}

/** Pinned chain presets in presentation order. */
export const CHAIN_PRESETS: Record<string, string[]> = {
  base: ["Record0", "Record1", "Record2", "Record3"],
  basePlus4F: ["Record0", "Record1", "Record2", "Record3", "Record4F"],
  basePlus4E: ["Record0", "Record1", "Record2", "Record3", "Record4E"],
  basePlus4A: ["Record0", "Record1", "Record2", "Record3", "Record4A"],
  basePlus4A4R: ["Record0", "Record1", "Record2", "Record3", "Record4A", "Record4R"],
  basePlus4A4R4B: ["Record0", "Record1", "Record2", "Record3", "Record4A", "Record4R", "Record4B"],
  chain0to4: ["Record0", "Record1", "Record2", "Record3", "Record4"],
  chain0to4plus5V: ["Record0", "Record1", "Record2", "Record3", "Record4", "Record5V"],
  chain0to4plus5: ["Record0", "Record1", "Record2", "Record3", "Record4", "Record5"],
  chain0to4plus6: ["Record0", "Record1", "Record2", "Record3", "Record4", "Record6"]
};

export function chainWires(preset: string): string[] {
  const presetWires = CHAIN_PRESETS[preset];
  if (presetWires === undefined) {
    throw new Error(`unknown L2 chain preset: ${preset}`);
  }
  return presetWires.map(vectorId => wire(vectorId));
}

/** Replace a unique fragment inside the pinned canonical payload text, keeping the pinned signature. */
export function wireWithEditedPayload(vectorId: string, search: string, replace: string): string {
  const vector = l2Vector(vectorId);
  const hits = vector.canonical.split(search).length - 1;
  if (hits !== 1) {
    throw new Error(`surgery target not unique in ${vectorId} (count ${String(hits)})`);
  }
  const edited = vector.canonical.replace(search, replace);
  return `{"payload":${edited},"signature":"${vector.signature}"}`;
}

/** Mutate a payload object and re-sign over the new canonical bytes with a fixture seed. */
export function reSignWire(baseVectorId: string, mutate: (payload: Record<string, unknown>) => void, signerKeyName: string): string {
  const payload = payloadOf(baseVectorId);
  mutate(payload);
  const canonical = jcsCanonicalize(payload);
  const signature = signWithSeed(l2Key(signerKeyName).seedString, canonical);
  return `{"payload":${canonical},"signature":"${signature}"}`;
}

/** Duplicate the first payload member at the start of the payload raw text. */
export function duplicateFirstPayloadMemberWire(vectorId: string): string {
  const vector = l2Vector(vectorId);
  const firstMember = vector.canonical.slice(1, vector.canonical.indexOf(",") + 1);
  const edited = `{"payload":{${firstMember}${vector.canonical.slice(1)},"signature":"${vector.signature}"}`;
  return edited;
}

/** Duplicate the first member of the embedded transfer trail payload. */
export function duplicateTrailMemberWire(vectorId: string): string {
  const vector = l2Vector(vectorId);
  const marker = '"transfer":{"payload":{';
  const index = vector.canonical.indexOf(marker);
  if (index < 0) {
    throw new Error(`transfer trail not found in ${vectorId}`);
  }
  const insertAt = index + marker.length;
  const firstMember = vector.canonical.slice(insertAt, vector.canonical.indexOf(",", insertAt) + 1);
  const edited = vector.canonical.slice(0, insertAt) + firstMember + vector.canonical.slice(insertAt);
  return `{"payload":${edited},"signature":"${vector.signature}"}`;
}

// Statement variants (string surgery keeps the canonical payload text canonical).
export const statementA = () => wire("S7");
export const statementS5 = () => wire("S5");
export const statementS6 = () => wire("S6");
export const statementS8 = () => wire("S8");
export const statementS9 = () => wire("S9");
export const statementS9v1 = () => wire("S9v1");
export const statementS9v2 = () => wire("S9v2");

export const statementAnchorMismatch = () =>
  wireWithEditedPayload("S7", `"anchorId":"${ANCHOR_ID}"`, `"anchorId":"660e8400-e29b-41d4-a716-446655440000"`);

export const statementUnknownAlgorithm = () =>
  wireWithEditedPayload("S7", `"algorithm":"ed25519"`, `"algorithm":"ED25519X"`);

export const statementNonIntegerTimestamp = () =>
  wireWithEditedPayload("S7", `"issuedAt":1769998300`, `"issuedAt":1769998300.5`);

export const statementL2VersionMismatch = () =>
  wireWithEditedPayload("S7", `"l2Version":"0.1"`, `"l2Version":"0.2"`);

export const statementSignatureInsidePayload = () => {
  const vector = l2Vector("S7");
  const marker = '"statementType"';
  const index = vector.canonical.indexOf(marker);
  const edited = vector.canonical.slice(0, index) + `"signature":"${vector.signature}",` + vector.canonical.slice(index);
  return `{"payload":${edited},"signature":"${vector.signature}"}`;
};

export const statementBelowFloor = () =>
  reSignWire("S7", payload => {
    payload["generation"] = 0;
  }, "key3");

export const statementExpired = () =>
  reSignWire("S7", payload => {
    payload["expiresAt"] = 1769998350;
  }, "key3");

/** Statement A re-signed under key2 for a retired-key scenario (new payload, pinned seeds only). */
export const statementUnderKey2InAcceptedEpoch = () =>
  reSignWire("S7", payload => {
    payload["keyId"] = l2Key("key2").keyId;
  }, "key2");

/** Statement A with the descriptionLocation changed, re-signed under key3 (equivocation payload). */
export const statementAEquivocated = () =>
  reSignWire("S7", payload => {
    payload["descriptionLocation"] = "https://sensors.example/thermal/42/ar-xml-equivocated";
  }, "key3");

/** Statement A signed by key5 (never present in the accepted chain). */
export const statementSignedByKey5 = () =>
  reSignWire("S7", payload => {
    payload["keyId"] = l2Key("key5").keyId;
  }, "key5");

// Record variants.
export const record2Key3PublicKeyTampered = () =>
  wireWithEditedPayload(
    "Record2",
    `"keyId":"${l2Key("key3").keyId}","publicKey":"${l2Key("key3").publicKey}"`,
    `"keyId":"${l2Key("key3").keyId}","publicKey":"${l2Key("key1").publicKey}"`
  );

/** Record 4B that re-registers the revoked key3 as current (terminal state reopened). */
export const record6ReRegistersRevokedKey = () =>
  reSignWire(
    "Record4B",
    payload => {
      const keys = payload["keys"] as Record<string, unknown>[];
      const key3 = keys.find(entry => entry["keyId"] === l2Key("key3").keyId);
      if (key3 === undefined) {
        throw new Error("key3 entry not found");
      }
      key3["status"] = "current";
      delete key3["revokedFrom"];
    },
    "key4"
  );

/** Record 1 that leaves key1 retired with validUntil above the truncation cap. */
export const record1RetirementCapViolated = () =>
  reSignWire(
    "Record1",
    payload => {
      const keys = payload["keys"] as Record<string, unknown>[];
      const key1 = keys.find(entry => entry["keyId"] === l2Key("key1").keyId);
      if (key1 === undefined) {
        throw new Error("key1 entry not found");
      }
      key1["validUntil"] = 1770000000;
    },
    "key1"
  );

/** Record 4 that changes the epoch without carrying a transfer member. */
export const recordEpochChangeWithoutTransfer = () =>
  reSignWire("Record4", payload => {
    payload["epochId"] = "epoch-2";
  }, "key3");

/** Record 1 that carries a transfer member without an epoch change. */
export const recordTransferWithoutEpochChange = () =>
  reSignWire("Record1", payload => {
    payload["transfer"] = payloadOf("Record2")["transfer"];
  }, "key1");

/** Record 3 with the required statementFloor member removed. */
export const recordMissingStatementFloor = () =>
  reSignWire("Record3", payload => {
    delete payload["statementFloor"];
  }, "key3");

/** Record 2 with a forbidden issuedAt member inside the trail payload. */
export const recordTrailForbiddenMember = () =>
  reSignWire(
    "Record2",
    payload => {
      const transfer = payload["transfer"] as { payload: Record<string, unknown> };
      transfer.payload["issuedAt"] = 1769997600;
    },
    "key2"
  );

/** Record 2 whose trail epochId does not match Record 1's epoch (trail verification failure). */
export const recordTrailEpochMismatch = () =>
  reSignWire(
    "Record2",
    payload => {
      const transfer = payload["transfer"] as { payload: Record<string, unknown> };
      transfer.payload["epochId"] = "epoch-9";
    },
    "key2"
  );

/** Record 2 that leaves key2 current after the epoch switch (incoming key not sole current). */
export const record2LeavesKey2Current = () =>
  reSignWire(
    "Record2",
    payload => {
      const keys = payload["keys"] as Record<string, unknown>[];
      const key2 = keys.find(entry => entry["keyId"] === l2Key("key2").keyId);
      if (key2 === undefined) {
        throw new Error("key2 entry not found");
      }
      key2["status"] = "current";
    },
    "key2"
  );

/** Record 4 signed by a key absent from Record 3 (signer outside the accepted chain). */
export const record4SignerAbsentFromPrevious = () =>
  reSignWire("Record4", payload => {
    payload["signerKeyId"] = l2Key("key5").keyId;
  }, "key5");

/** A generation-4 Record whose transfer trail names epoch-0, an already accepted epoch. */
export function recordReentersAcceptedEpoch(): string {
  const seed6Bytes = deriveSeedFromSeedString("relink-l2-0.1-draft-test-vector-seed-6");
  const key6PublicKey = base64urlEncode(Buffer.from(publicKeyHexFromSeed(seed6Bytes), "hex"));
  const key6KeyId = computeKeyId(key6PublicKey);
  const reentryIssuedAt = 1769998300;
  const key3KeyId = l2Key("key3").keyId;
  const keys = (payloadOf("Record3")["keys"] as KeyEntry[]).map(entry => ({ ...entry }));
  for (const entry of keys) {
    if (entry.status === "current") {
      entry.status = "retired";
      entry.validUntil = Math.min(entry.validUntil, reentryIssuedAt);
    }
  }
  keys.push({
    algorithm: "ed25519",
    keyId: key6KeyId,
    publicKey: key6PublicKey,
    status: "current",
    validFrom: reentryIssuedAt,
    validUntil: 1770001900
  });
  return reSignWire(
    "Record4",
    payload => {
      payload["issuedAt"] = reentryIssuedAt;
      payload["expiresAt"] = 1770001900;
      payload["epochId"] = "epoch-0";
      payload["signerKeyId"] = key3KeyId;
      payload["statementFloor"] = 0;
      payload["keys"] = keys;
      payload["transfer"] = {
        payload: {
          algorithm: "ed25519",
          anchorId: ANCHOR_ID,
          entityId: ENTITY_ID,
          epochId: "epoch-1",
          incomingKeyId: key6KeyId,
          l2Version: "0.1",
          newEpochId: "epoch-0",
          outgoingKeyId: key3KeyId,
          recordGeneration: 4,
          statementFloor: 0,
          statementType: "transfer"
        },
        signature: signWithSeed(l2Key("key3").seedString, jcsCanonicalize({
          algorithm: "ed25519",
          anchorId: ANCHOR_ID,
          entityId: ENTITY_ID,
          epochId: "epoch-1",
          incomingKeyId: key6KeyId,
          l2Version: "0.1",
          newEpochId: "epoch-0",
          outgoingKeyId: key3KeyId,
          recordGeneration: 4,
          statementFloor: 0,
          statementType: "transfer"
        }))
      };
    },
    "key3"
  );
}

/** Record 0 presenting key4 as the binding key (self-bootstrapping introduction). */
export const record0SelfBootstrap = () =>
  reSignWire(
    "Record0",
    payload => {
      payload["signerKeyId"] = l2Key("key4").keyId;
      payload["keys"] = [
        {
          keyId: l2Key("key4").keyId,
          publicKey: l2Key("key4").publicKey,
          algorithm: "ed25519",
          validFrom: payload["issuedAt"],
          validUntil: payload["expiresAt"],
          status: "current"
        }
      ];
    },
    "key4"
  );

/** Record 3 with the same generation as the accepted maximum and a different payload. */
export const record3SameGenerationDifferentPayload = () =>
  reSignWire("Record3", payload => {
    payload["expiresAt"] = 1770001801;
  }, "key3");

/** Record 3 with a key entry deleted (identity loss). */
export const record3DeletesKey1Entry = () =>
  reSignWire(
    "Record3",
    payload => {
      payload["keys"] = (payload["keys"] as Record<string, unknown>[]).filter(
        entry => entry["keyId"] !== l2Key("key1").keyId
      );
    },
    "key3"
  );
