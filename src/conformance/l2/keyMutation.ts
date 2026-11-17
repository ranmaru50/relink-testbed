// src/conformance/l2/keyMutation.ts
// §9.5 Key mutation rules: identity fields immutable, entries never deleted,
// keyId never re-registered against a different publicKey, revokedFrom set only at
// the first current→revoked/compromised transition to this recordGeneration and
// immutable thereafter, terminal states (revoked/compromised/retired) never return
// to current, validUntil never extended/widened/shortened outside the three
// transition paths, new keys introduced only as current with validFrom == issuedAt(G).

import type { KeyEntry, KeyStatus, TransferEnvelope } from "./model.js";

export interface KeyMutationContext {
  prevKeys: KeyEntry[];
  nextKeys: KeyEntry[];
  recordGeneration: number;
  issuedAt: number;
  isTransfer: boolean;
  /** Introduction context: the Record introduces at least one new key. */
  introducesNewKey: boolean;
  /** For a transfer Record, the sole key that may be current in G. */
  incomingKeyId?: string;
}

export interface MutationViolation {
  rule: string;
  keyId: string;
}

const TERMINAL: KeyStatus[] = ["revoked", "compromised", "retired"];

export function validateKeyMutation(context: KeyMutationContext): MutationViolation[] {
  const violations: MutationViolation[] = [];
  const prevByPublic = new Map<string, KeyEntry>();
  for (const entry of context.prevKeys) {
    prevByPublic.set(entry.publicKey, entry);
  }
  const prevByKeyId = new Map<string, KeyEntry>();
  for (const entry of context.prevKeys) {
    prevByKeyId.set(entry.keyId, entry);
  }

  const nextByKeyId = new Map<string, KeyEntry>();
  for (const entry of context.nextKeys) {
    const existing = nextByKeyId.get(entry.keyId);
    if (existing !== undefined) {
      violations.push({ rule: "duplicate-keyid-in-snapshot", keyId: entry.keyId });
      continue;
    }
    nextByKeyId.set(entry.keyId, entry);
  }

  // Entries present in G-1 are never deleted.
  for (const entry of context.prevKeys) {
    if (!nextByKeyId.has(entry.keyId)) {
      violations.push({ rule: "key-entry-deleted", keyId: entry.keyId });
    }
  }

  for (const next of context.nextKeys) {
    const prev = prevByKeyId.get(next.keyId);
    if (prev === undefined) {
      // Newly introduced key.
      const reRegistered = prevByPublic.get(next.publicKey);
      if (reRegistered !== undefined) {
        violations.push({ rule: "keyid-re-registered-against-known-publickey", keyId: next.keyId });
        continue;
      }
      if (next.status !== "current") {
        violations.push({ rule: "new-key-not-current", keyId: next.keyId });
      }
      if (next.validFrom !== context.issuedAt) {
        violations.push({ rule: "new-key-validFrom-not-issuedAt", keyId: next.keyId });
      }
      continue;
    }

    // Identity fields are immutable.
    if (next.publicKey !== prev.publicKey) {
      violations.push({ rule: "identity-mutation-publicKey", keyId: next.keyId });
    }
    if (next.algorithm !== prev.algorithm) {
      violations.push({ rule: "identity-mutation-algorithm", keyId: next.keyId });
    }
    if (next.validFrom !== prev.validFrom) {
      violations.push({ rule: "identity-mutation-validFrom", keyId: next.keyId });
    }

    if (TERMINAL.includes(prev.status)) {
      // Terminal states never return to current and the terminal evidence stays.
      if (next.status !== prev.status) {
        violations.push({ rule: "terminal-state-reopened", keyId: next.keyId });
      }
      if (next.validUntil !== prev.validUntil) {
        violations.push({ rule: "terminal-validUntil-changed", keyId: next.keyId });
      }
      if (prev.revokedFrom !== undefined && next.revokedFrom !== prev.revokedFrom) {
        violations.push({ rule: "revokedFrom-mutated", keyId: next.keyId });
      }
      continue;
    }

    // prev status is "current".
    if (next.status === "current") {
      if (next.revokedFrom !== undefined) {
        violations.push({ rule: "revokedFrom-on-current", keyId: next.keyId });
      }
      if (next.validUntil !== prev.validUntil) {
        // A current entry's validUntil may change only via rotation introduction, transfer
        // truncation, or a transition; a revocation-only Record must not move it.
        if (!context.introducesNewKey && !context.isTransfer) {
          violations.push({ rule: "validUntil-changed-without-transition", keyId: next.keyId });
        }
      }
      continue;
    }

    if (next.status === "retired") {
      const expected = Math.min(prev.validUntil, context.issuedAt);
      if (next.validUntil !== expected) {
        violations.push({ rule: "retired-validUntil-not-min", keyId: next.keyId });
      }
      if (next.revokedFrom !== undefined) {
        violations.push({ rule: "revokedFrom-on-retired", keyId: next.keyId });
      }
      continue;
    }

    if (next.status === "revoked" || next.status === "compromised") {
      if (next.revokedFrom !== context.recordGeneration) {
        violations.push({ rule: "revokedFrom-not-current-generation", keyId: next.keyId });
      }
      continue;
    }

    violations.push({ rule: "status-not-allowed", keyId: next.keyId });
  }

  if (context.isTransfer) {
    // A transfer Record MUST mark every current key of G-1 as retired.
    for (const entry of context.prevKeys) {
      if (entry.status === "current") {
        const next = nextByKeyId.get(entry.keyId);
        if (next === undefined || next.status !== "retired") {
          violations.push({ rule: "transfer-marks-outgoing-current", keyId: entry.keyId });
        }
      }
    }
    if (context.incomingKeyId !== undefined) {
      for (const entry of context.nextKeys) {
        if (entry.status === "current" && entry.keyId !== context.incomingKeyId) {
          violations.push({ rule: "non-incoming-current-after-transfer", keyId: entry.keyId });
        }
      }
    }
  }

  return violations;
}

export function countIntroducedCurrentKeys(nextKeys: KeyEntry[], issuedAt: number): number {
  return nextKeys.filter(entry => entry.status === "current" && entry.validFrom === issuedAt).length;
}

export function findTransferIncoming(trail: TransferEnvelope): string {
  return trail.payload["incomingKeyId"] as string;
}
