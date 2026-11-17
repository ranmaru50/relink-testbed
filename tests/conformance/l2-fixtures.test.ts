// tests/conformance/l2-fixtures.test.ts
// Self-consistency of the pinned L2 fixtures: every payload string is JCS-canonical, the
// canonicalization of each parsed payload reproduces the pinned bytes, keyId recomputes from
// publicKey for every fixture key, the seed-derived key material matches the pinned vectors,
// and the pinned signatures verify over the canonical payload bytes. This validates the
// PKCS#8 ed25519 seed prefix empirically against A2-Vector1.
//
// Catalog coverage: L2-PRO-002, L2-PRO-008, L2-PRO-010, L2-VER-046 (fixtures-side checks;
// the catalog-side handlers live in the l2-producer / l2-verifier suites).

import { describe, expect, it } from "vitest";
import { l2Fixtures, l2Key, l2Vector, l2WireEnvelope } from "../../src/conformance/l2/fixtures/l2Fixtures.js";
import { jcsCanonicalize } from "../../src/conformance/l2/jcs.js";
import { computeKeyId, sha256HexOfUtf8 } from "../../src/conformance/l2/keyId.js";
import { base64urlDecode, isBase64urlNoPadding } from "../../src/conformance/l2/base64url.js";
import { deriveSeedFromSeedString, publicKeyHexFromSeed, signWithSeed, verifyEd25519 } from "../../src/conformance/l2/ed25519.js";
import { parseWireEnvelope } from "../../src/conformance/l2/wire.js";

describe("L2 fixtures self-consistency", () => {
  it("L2-PRO-002, L2-VER-046 — every pinned payload string is JCS-canonical and reproducible", () => {
    for (const vector of l2Fixtures.vectors) {
      const payload = JSON.parse(vector.canonical) as Record<string, unknown>;
      expect(jcsCanonicalize(payload), vector.id).toBe(vector.canonical);
    }
  });

  it("L2-VER-046 — wire envelopes carry the pinned payload bytes verbatim", () => {
    for (const vector of l2Fixtures.vectors) {
      const envelope = parseWireEnvelope(l2WireEnvelope(vector.id));
      expect(envelope.payloadWireText, vector.id).toBe(vector.canonical);
      expect(envelope.signature, vector.id).toBe(vector.signature);
    }
  });

  it("L2-PRO-008 — keyId recomputes from publicKey for every fixture key", () => {
    for (const name of ["key1", "key2", "key3", "key4", "key5"]) {
      const key = l2Key(name);
      expect(computeKeyId(key.publicKey), name).toBe(key.keyId);
      expect(key.keyId.length).toBe(11);
      expect(base64urlDecode(key.keyId).length).toBe(8);
      expect(base64urlDecode(key.publicKey).length).toBe(32);
      expect(isBase64urlNoPadding(key.keyId)).toBe(true);
      expect(isBase64urlNoPadding(key.publicKey)).toBe(true);
    }
  });

  it("L2-PRO-002 — the PKCS#8 seed prefix reproduces the pinned key1 material and signature", () => {
    const seed = deriveSeedFromSeedString(l2Fixtures.constants.SEED_STRING_1);
    expect(Buffer.from(seed).toString("hex")).toBe(l2Fixtures.constants.KEY1_PRIVATE_SEED_HEX);
    expect(publicKeyHexFromSeed(seed)).toBe(l2Fixtures.constants.KEY1_PUBLIC_HEX);
    expect(l2Key("key1").publicHex).toBe(l2Fixtures.constants.KEY1_PUBLIC_HEX);
    const vector = l2Vector("A2-Vector1");
    const recomputedSignature = signWithSeed(l2Fixtures.constants.SEED_STRING_1, vector.canonical);
    expect(recomputedSignature).toBe(vector.signature);
    expect(verifyEd25519(l2Key("key1").publicKey, vector.signature, vector.canonical)).toBe(true);
  });

  it("L2-PRO-010 — the escape fixture is canonical and its digest relation is consistent", () => {
    const vector = l2Vector("A4-Vector3b");
    expect(jcsCanonicalize(JSON.parse(vector.canonical) as Record<string, unknown>)).toBe(vector.canonical);
    expect(/^[0-9a-f]{64}$/.test(sha256HexOfUtf8(vector.canonical))).toBe(true);
    expect((JSON.parse(vector.canonical) as Record<string, unknown>)["digestRelationCheck"]).toBeUndefined();
  });

  it("L2-PRO-011 — every pinned signature verifies over its canonical payload bytes", () => {
    const failures: string[] = [];
    for (const vector of l2Fixtures.vectors) {
      if (!verifyEd25519(vector.signerPublicKey, vector.signature, vector.canonical)) {
        failures.push(vector.id);
      }
      expect(vector.signature.length).toBe(86);
      expect(isBase64urlNoPadding(vector.signature)).toBe(true);
      expect(base64urlDecode(vector.signature).length).toBe(64);
    }
    expect(failures).toEqual([]);
  });

  it("L2-VER-047 — the S9 variants have the pinned byte lengths 364 / 364 / 366", () => {
    expect(l2Vector("S9").canonical.length).toBe(364);
    expect(l2Vector("S9v1").canonical.length).toBe(364);
    expect(l2Vector("S9v2").canonical.length).toBe(366);
  });
});
