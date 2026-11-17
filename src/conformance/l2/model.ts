// src/conformance/l2/model.ts
// Typed L2 0.1 payload shapes and phase-1 field validation: required members,
// integer ranges, l2Version, statementType, forbidden members (§7.2, §9.5, §12.2).

import type { JsonValue } from "./wire.js";
import { isBase64urlNoPadding } from "./base64url.js";

export type KeyStatus = "current" | "retired" | "revoked" | "compromised";

export interface KeyEntry {
  keyId: string;
  publicKey: string;
  algorithm: string;
  validFrom: number;
  validUntil: number;
  status: KeyStatus;
  revokedFrom?: number;
}

export interface TransferPayload {
  statementType: "transfer";
  l2Version: string;
  anchorId: string;
  entityId: string;
  outgoingKeyId: string;
  incomingKeyId: string;
  algorithm: string;
  epochId: string;
  newEpochId: string;
  recordGeneration: number;
  statementFloor: number;
}

export interface TransferEnvelope {
  payload: TransferPayload;
  signature: string;
  payloadWireText: string;
}

export interface RecordPayload {
  l2Version: string;
  statementType: "authority";
  anchorId: string;
  entityId: string;
  recordGeneration: number;
  signerKeyId: string;
  algorithm: string;
  issuedAt: number;
  expiresAt: number;
  epochId: string;
  prevRecordDigest: string | null;
  statementFloor: number;
  keys: KeyEntry[];
  transfer?: TransferEnvelope;
}

export interface StatementPayload {
  l2Version: string;
  statementType: "resolution";
  anchorId: string;
  entityId: string;
  descriptionLocation: string;
  epochId: string;
  generation: number;
  issuedAt: number;
  expiresAt: number;
  keyId: string;
  algorithm: string;
  lifecycleStatus: string;
}

export const L2_VERSION = "0.1";

const STATEMENT_REQUIRED = [
  "l2Version",
  "statementType",
  "keyId",
  "anchorId",
  "entityId",
  "descriptionLocation",
  "epochId",
  "generation",
  "issuedAt",
  "expiresAt",
  "algorithm",
  "lifecycleStatus"
];

const RECORD_REQUIRED = [
  "l2Version",
  "statementType",
  "anchorId",
  "entityId",
  "recordGeneration",
  "signerKeyId",
  "algorithm",
  "issuedAt",
  "expiresAt",
  "epochId",
  "prevRecordDigest",
  "statementFloor",
  "keys"
];

const TRAIL_REQUIRED = [
  "l2Version",
  "statementType",
  "anchorId",
  "entityId",
  "outgoingKeyId",
  "incomingKeyId",
  "algorithm",
  "epochId",
  "newEpochId",
  "recordGeneration",
  "statementFloor"
];

const TRAIL_FORBIDDEN = ["keyId", "generation", "issuedAt", "expiresAt", "descriptionLocation", "lifecycleStatus", "effectiveGeneration"];

export function isIntegerInRange(value: JsonValue): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2 ** 53 - 1;
}

function requiredMembers(payload: Record<string, JsonValue>, names: string[]): string[] {
  const failures: string[] = [];
  for (const name of names) {
    if (!(name in payload)) {
      failures.push(`missing-member:${name}`);
    }
  }
  return failures;
}

export function validateStatementPayload(payload: Record<string, JsonValue>): string[] {
  const failures = requiredMembers(payload, STATEMENT_REQUIRED);
  if (payload["signature"] !== undefined) {
    failures.push("signature-inside-payload");
  }
  if (payload["l2Version"] !== L2_VERSION) {
    failures.push("l2Version-mismatch");
  }
  if (payload["statementType"] !== "resolution") {
    failures.push("statementType-mismatch");
  }
  const lifecycle = payload["lifecycleStatus"];
  if (lifecycle !== "active" && lifecycle !== "suspended" && lifecycle !== "retired") {
    failures.push("lifecycleStatus-not-allowed");
  }
  for (const name of ["issuedAt", "expiresAt", "generation"]) {
    if (!isIntegerInRange(payload[name] ?? null)) {
      failures.push(`non-integer:${name}`);
    }
  }
  for (const name of ["keyId", "anchorId", "entityId", "descriptionLocation", "epochId", "algorithm", "lifecycleStatus"]) {
    if (typeof payload[name] !== "string") {
      failures.push(`not-string:${name}`);
    }
  }
  return failures;
}

export function validateRecordPayload(payload: Record<string, JsonValue>): string[] {
  const failures = requiredMembers(payload, RECORD_REQUIRED);
  if (payload["signature"] !== undefined) {
    failures.push("signature-inside-payload");
  }
  if (payload["l2Version"] !== L2_VERSION) {
    failures.push("l2Version-mismatch");
  }
  if (payload["statementType"] !== "authority") {
    failures.push("statementType-mismatch");
  }
  for (const name of ["recordGeneration", "issuedAt", "expiresAt", "statementFloor"]) {
    if (!isIntegerInRange(payload[name] ?? null)) {
      failures.push(`non-integer:${name}`);
    }
  }
  const prevDigest = payload["prevRecordDigest"] ?? null;
  if (prevDigest !== null && !(typeof prevDigest === "string" && /^[0-9a-f]{64}$/.test(prevDigest))) {
    failures.push("prevRecordDigest-not-lowercase-hex");
  }
  const keys = payload["keys"];
  if (!Array.isArray(keys)) {
    failures.push("keys-not-array");
  } else {
    for (const entry of keys) {
      failures.push(...validateKeyEntry(entry));
    }
  }
  return failures;
}

export function validateKeyEntry(entry: JsonValue): string[] {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return ["key-entry-not-object"];
  }
  const e = entry as Record<string, JsonValue>;
  const failures = requiredMembers(e, ["keyId", "publicKey", "algorithm", "validFrom", "validUntil", "status"]);
  for (const name of ["validFrom", "validUntil"]) {
    if (!isIntegerInRange(e[name] ?? null)) {
      failures.push(`non-integer:${name}`);
    }
  }
  if (typeof e["keyId"] !== "string" || e["keyId"].length !== 11 || !isBase64urlNoPadding(e["keyId"])) {
    failures.push("keyId-not-11-char-base64url");
  }
  if (typeof e["publicKey"] !== "string" || !isBase64urlNoPadding(e["publicKey"])) {
    failures.push("publicKey-not-base64url");
  }
  const status = e["status"];
  if (status !== "current" && status !== "retired" && status !== "revoked" && status !== "compromised") {
    failures.push("status-not-allowed");
  }
  const revokedFrom = e["revokedFrom"];
  if ((status === "revoked" || status === "compromised") && !isIntegerInRange(revokedFrom ?? null)) {
    failures.push("revokedFrom-required");
  }
  if (status === "current" && revokedFrom !== undefined) {
    failures.push("revokedFrom-on-current");
  }
  return failures;
}

export function validateTrailPayload(payload: Record<string, JsonValue>): string[] {
  const failures = requiredMembers(payload, TRAIL_REQUIRED);
  for (const name of TRAIL_FORBIDDEN) {
    if (payload[name] !== undefined) {
      failures.push(`forbidden-member:${name}`);
    }
  }
  if (payload["l2Version"] !== L2_VERSION) {
    failures.push("l2Version-mismatch");
  }
  if (payload["statementType"] !== "transfer") {
    failures.push("statementType-mismatch");
  }
  if (!isIntegerInRange(payload["recordGeneration"] ?? null) || !isIntegerInRange(payload["statementFloor"] ?? null)) {
    failures.push("non-integer-position-fields");
  }
  return failures;
}
