// src/conformance/l2/jcs.ts
// JCS (RFC 8785) canonical JSON serialization for L2 0.1 signing targets (§7.3).

const MINIMAL_ESCAPES: Record<string, string> = {
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\f": "\\f",
  "\r": "\\r"
};

function escapeJsonString(value: string): string {
  let out = '"';
  for (const char of value) {
    const code = char.charCodeAt(0);
    const direct = MINIMAL_ESCAPES[char];
    if (direct !== undefined) {
      out += direct;
    } else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, "0").toUpperCase()}`;
    } else {
      // U+2028, U+2029, U+007F and every other code point stay raw in the L2 0.1
      // signing target, matching the pinned canonical vectors byte-for-byte.
      out += char;
    }
  }
  return `${out}"`;
}

function isL2SafeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 2 ** 53 - 1;
}

function canonicalizeNode(value: unknown, integersOnly: boolean): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`jcs: non-finite number ${String(value)}`);
    }
    if (integersOnly && !isL2SafeInteger(value)) {
      throw new Error(`jcs: number outside the L2 integer range: ${String(value)}`);
    }
    return String(value);
  }
  if (typeof value === "string") return escapeJsonString(value);
  if (Array.isArray(value)) {
    const items = value.map(item => canonicalizeNode(item, integersOnly));
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    // JS string comparison is UTF-16 code-unit order, which is the RFC 8785 rule,
    // including the surrogate-pair rule for non-BMP keys.
    keys.sort();
    const members: string[] = [];
    for (const key of keys) {
      const memberValue = record[key];
      if (memberValue === undefined) {
        throw new Error(`jcs: member ${key} is undefined`);
      }
      members.push(`${escapeJsonString(key)}:${canonicalizeNode(memberValue, integersOnly)}`);
    }
    return `{${members.join(",")}}`;
  }
  throw new Error(`jcs: unsupported value type ${typeof value}`);
}

export interface JcsOptions {
  /** L2 signing targets restrict numbers to the 0..2^53-1 integer range. */
  l2IntegersOnly?: boolean;
}

export function jcsCanonicalize(value: unknown, options: JcsOptions = {}): string {
  return canonicalizeNode(value, options.l2IntegersOnly === true);
}
