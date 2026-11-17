// src/conformance/l2/base64url.ts
// base64url encoding per RFC 4648 §5 with "=" padding stripped, as required by L2 0.1 §10.1.

export function base64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function base64urlDecode(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? 0 : 4 - (padded.length % 4);
  return new Uint8Array(Buffer.from(padded + "=".repeat(pad), "base64"));
}

const BASE64URL_NO_PADDING = /^[A-Za-z0-9_-]+$/;

export function isBase64urlNoPadding(text: string): boolean {
  return text.length > 0 && BASE64URL_NO_PADDING.test(text);
}
