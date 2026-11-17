// src/conformance/l2/ed25519.ts
// Ed25519 verify and seed-derive sign helpers per L2 0.1 §10.2 and Appendix A.6.
// Only node:crypto is used; keys are built from PKCS#8 / SPKI wrappers.

import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { base64urlDecode, base64urlEncode } from "./base64url.js";

// PKCS#8 PrivateKeyInfo prefix for ed25519 (RFC 8410): version 0, OID 1.3.101.112,
// then an OCTET STRING wrapping the OCTET STRING seed.
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
// SPKI prefix for ed25519: SEQUENCE { SEQUENCE { OID 1.3.101.112 }, BIT STRING }.
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function deriveSeedFromSeedString(seedString: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(Buffer.from(seedString, "utf8")).digest());
}

export function privateKeyFromSeed(seedBytes: Uint8Array) {
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seedBytes)]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

export function publicKeyHexFromSeed(seedBytes: Uint8Array): string {
  const publicKey = createPublicKey(privateKeyFromSeed(seedBytes));
  const spki = Buffer.from(publicKey.export({ format: "der", type: "spki" }));
  return spKIraw(spki).toString("hex");
}

function spKIraw(spki: Buffer): Buffer {
  return spki.subarray(spki.length - 32);
}

export function signWithSeed(seedString: string, messageUtf8: string): string {
  const seed = deriveSeedFromSeedString(seedString);
  const signature = sign(null, Buffer.from(messageUtf8, "utf8"), privateKeyFromSeed(seed));
  return base64urlEncode(new Uint8Array(signature));
}

export function verifyEd25519(publicKeyBase64url: string, signatureBase64url: string, messageUtf8: string): boolean {
  try {
    const raw = base64urlDecode(publicKeyBase64url);
    if (raw.length !== 32) return false;
    const signatureBytes = base64urlDecode(signatureBase64url);
    if (signatureBytes.length !== 64) return false;
    const der = Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(raw)]);
    const publicKey = createPublicKey({ key: der, format: "der", type: "spki" });
    return verify(null, Buffer.from(messageUtf8, "utf8"), publicKey, Buffer.from(signatureBytes));
  } catch {
    return false;
  }
}
