// src/conformance/l2/keyId.ts
// keyId = base64url of the first 8 bytes of SHA-256 over the raw publicKey bytes (§10.1).

import { createHash } from "node:crypto";
import { base64urlDecode, base64urlEncode } from "./base64url.js";

export function computeKeyId(publicKeyBase64url: string): string {
  const raw = base64urlDecode(publicKeyBase64url);
  const digest = createHash("sha256").update(raw).digest();
  return base64urlEncode(digest.subarray(0, 8));
}

/** Exact, case-sensitive comparison; the wire keyId is never normalized. */
export function keyIdMatches(wireKeyId: string, publicKeyBase64url: string): boolean {
  return wireKeyId === computeKeyId(publicKeyBase64url);
}

export function sha256HexOfUtf8(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex").toLowerCase();
}
