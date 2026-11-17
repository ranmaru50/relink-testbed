// src/conformance/l2/wire.ts
// Strict wire parsing for L2 0.1 §7.1/§7.3 envelopes: `{ payload, signature }`.
// Duplicate members are detected in the raw wire text before any trust evaluation,
// and the payload member must already be the JCS serialization on the wire.

import { jcsCanonicalize } from "./jcs.js";
import { isBase64urlNoPadding } from "./base64url.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface JsonNode {
  raw: string;
  value: JsonValue;
}

export class WireError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

interface ParsedMember {
  name: string;
  value: JsonNode;
}

class StrictParser {
  private readonly text: string;
  private pos = 0;

  constructor(text: string) {
    this.text = text;
  }

  static parse(text: string): JsonNode {
    const parser = new StrictParser(text);
    const node = parser.parseValue();
    parser.skipWhitespace();
    if (parser.pos !== text.length) {
      throw new WireError("trailing-content");
    }
    return node;
  }

  private skipWhitespace(): void {
    while (this.pos < this.text.length && /[ \t\r\n]/.test(this.text[this.pos] ?? "")) {
      this.pos += 1;
    }
  }

  private parseValue(): JsonNode {
    this.skipWhitespace();
    const start = this.pos;
    const char = this.text[this.pos];
    if (char === "{") {
      const members = this.parseObjectBody();
      return { raw: this.text.slice(start, this.pos), value: membersToObject(members) };
    }
    if (char === "[") {
      const items = this.parseArrayBody();
      return { raw: this.text.slice(start, this.pos), value: items.map(item => item.value) };
    }
    if (char === '"') {
      const value = this.parseStringLiteral();
      return { raw: this.text.slice(start, this.pos), value };
    }
    if (this.text.startsWith("true", this.pos)) {
      this.pos += 4;
      return { raw: "true", value: true };
    }
    if (this.text.startsWith("false", this.pos)) {
      this.pos += 5;
      return { raw: "false", value: false };
    }
    if (this.text.startsWith("null", this.pos)) {
      this.pos += 4;
      return { raw: "null", value: null };
    }
    const numberValue = this.parseNumberLiteral();
    return { raw: this.text.slice(start, this.pos), value: numberValue };
  }

  private parseStringLiteral(): string {
    // The opening quote is at this.pos.
    this.pos += 1;
    let out = "";
    while (this.pos < this.text.length) {
      const char = this.text[this.pos] ?? "";
      if (char === '"') {
        this.pos += 1;
        return out;
      }
      if (char === "\\") {
        const next = this.text[this.pos + 1] ?? "";
        if (next === '"' || next === "\\" || next === "/") {
          out += next === "/" ? "/" : next;
          this.pos += 2;
        } else if (next === "b") {
          out += "\b";
          this.pos += 2;
        } else if (next === "t") {
          out += "\t";
          this.pos += 2;
        } else if (next === "n") {
          out += "\n";
          this.pos += 2;
        } else if (next === "r") {
          out += "\r";
          this.pos += 2;
        } else if (next === "f") {
          out += "\f";
          this.pos += 2;
        } else if (next === "u") {
          const hex = this.text.slice(this.pos + 2, this.pos + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new WireError("malformed-string-escape");
          }
          out += String.fromCharCode(Number.parseInt(hex, 16));
          this.pos += 6;
        } else {
          throw new WireError("malformed-string-escape");
        }
        continue;
      }
      const code = char.charCodeAt(0);
      if (code < 0x20) {
        throw new WireError("control-character-in-string");
      }
      out += char;
      this.pos += 1;
    }
    throw new WireError("unterminated-string");
  }

  private parseNumberLiteral(): number {
    const match = /^(?:0|-?[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(this.text.slice(this.pos));
    if (match === null || match[0] === "") {
      throw new WireError("malformed-number");
    }
    const value = Number(match[0]);
    if (!Number.isFinite(value)) {
      throw new WireError("non-finite-number");
    }
    this.pos += match[0].length;
    return value;
  }

  private parseObjectBody(): ParsedMember[] {
    this.pos += 1; // consume '{'
    const members: ParsedMember[] = [];
    const seen = new Set<string>();
    this.skipWhitespace();
    if (this.text[this.pos] === "}") {
      this.pos += 1;
      return members;
    }
    while (true) {
      this.skipWhitespace();
      if (this.text[this.pos] !== '"') {
        throw new WireError("object-member-name-must-be-string");
      }
      const name = this.parseStringLiteral();
      this.skipWhitespace();
      if (this.text[this.pos] !== ":") {
        throw new WireError("missing-colon-after-member-name");
      }
      this.pos += 1;
      const value = this.parseValue();
      if (seen.has(name)) {
        // Duplicate member detection happens on the raw wire text, before parsing.
        throw new WireError("duplicate-member");
      }
      seen.add(name);
      members.push({ name, value });
      this.skipWhitespace();
      const next = this.text[this.pos];
      if (next === ",") {
        this.pos += 1;
        continue;
      }
      if (next === "}") {
        this.pos += 1;
        return members;
      }
      throw new WireError("malformed-object");
    }
  }

  private parseArrayBody(): JsonNode[] {
    this.pos += 1; // consume '['
    const items: JsonNode[] = [];
    this.skipWhitespace();
    if (this.text[this.pos] === "]") {
      this.pos += 1;
      return items;
    }
    while (true) {
      items.push(this.parseValue());
      this.skipWhitespace();
      const next = this.text[this.pos];
      if (next === ",") {
        this.pos += 1;
        continue;
      }
      if (next === "]") {
        this.pos += 1;
        return items;
      }
      throw new WireError("malformed-array");
    }
  }
}

function membersToObject(members: ParsedMember[]): { [key: string]: JsonValue } {
  const out: { [key: string]: JsonValue } = {};
  for (const member of members) {
    out[member.name] = member.value.value;
  }
  return out;
}

export interface WireEnvelope {
  /** Top-level member names, in wire order. */
  memberNames: string[];
  payload: { [key: string]: JsonValue };
  /** The payload member exactly as it appears on the wire; must equal its JCS serialization. */
  payloadWireText: string;
  signature: string;
  /** The full envelope text, outer whitespace trimmed. */
  trimmedWire: string;
}

/**
 * Parse a `{ payload, signature }` wire object. Outer envelope whitespace is tolerated;
 * the payload member must already be the JCS serialization, and duplicate members
 * anywhere in the raw text fail the parse.
 */
export function parseWireEnvelope(wireText: string): WireEnvelope {
  const trimmed = wireText.trim();
  if (!trimmed.startsWith('{"payload":')) {
    throw new WireError("envelope-members-not-payload-signature");
  }
  const payloadRaw = findPayloadMemberRaw(trimmed);
  const payloadNode = StrictParser.parse(payloadRaw);
  if (payloadNode.value === null || typeof payloadNode.value !== "object" || Array.isArray(payloadNode.value)) {
    throw new WireError("payload-not-object");
  }
  const payloadCanonical = jcsCanonicalize(payloadNode.value);
  if (payloadCanonical !== payloadRaw) {
    throw new WireError("payload-not-jcs-canonical");
  }
  const signatureRaw = trimmed.slice('{"payload":'.length + payloadRaw.length);
  if (!signatureRaw.startsWith(',"signature":')) {
    throw new WireError("envelope-members-not-payload-signature");
  }
  const signatureLiteral = signatureRaw.slice(',"signature":'.length);
  if (!signatureLiteral.endsWith("}")) {
    throw new WireError("envelope-members-not-payload-signature");
  }
  const signatureNode = StrictParser.parse(signatureLiteral.slice(0, signatureLiteral.length - 1));
  if (typeof signatureNode.value !== "string") {
    throw new WireError("signature-not-string");
  }
  if (JSON.stringify(signatureNode.value) !== signatureNode.raw) {
    throw new WireError("signature-not-canonical");
  }
  const signature = signatureNode.value;
  if (signature.length !== 86 || !isBase64urlNoPadding(signature)) {
    throw new WireError("signature-not-base64url-86");
  }
  return {
    memberNames: ["payload", "signature"],
    payload: payloadNode.value as { [key: string]: JsonValue },
    payloadWireText: payloadRaw,
    signature,
    trimmedWire: trimmed
  };
}

function findPayloadMemberRaw(trimmed: string): string {
  const prefix = '{"payload":';
  const start = trimmed.indexOf(prefix);
  if (start !== 0) {
    throw new WireError("payload-member-position");
  }
  const valueStart = prefix.length;
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = valueStart; index < trimmed.length; index += 1) {
    const char = trimmed[index] ?? "";
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
      continue;
    }
    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        const rest = trimmed.slice(index + 1);
        if (!rest.startsWith(',"signature":')) {
          throw new WireError("payload-member-position");
        }
        return trimmed.slice(valueStart, index + 1);
      }
      continue;
    }
    if (char === ",") {
      continue;
    }
  }
  throw new WireError("payload-member-position");
}

/** Build a canonical wire envelope from a canonical payload string and a signature. */
export function wireEnvelope(payloadCanonical: string, signature: string): string {
  return `{"payload":${payloadCanonical},"signature":${JSON.stringify(signature)}}`;
}
