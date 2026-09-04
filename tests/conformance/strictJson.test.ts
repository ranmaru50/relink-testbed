// tests/conformance/strictJson.test.ts

import { describe, expect, it } from "vitest";
import { assertNoDuplicateObjectMembers } from "../../src/conformance/strictJson.js";

describe("assertNoDuplicateObjectMembers", () => {
  it("accepts nested objects and arrays without duplicate members", () => {
    expect(() => assertNoDuplicateObjectMembers('{"anchor":{"id":"a"},"items":[{"id":"b"}]}')).not.toThrow();
  });

  it("detects duplicate names at the top level", () => {
    expect(() => assertNoDuplicateObjectMembers('{"anchor":{},"anchor":{}}')).toThrow("duplicate member");
  });

  it("detects duplicate names in a nested object, including escaped names", () => {
    expect(() => assertNoDuplicateObjectMembers('{"anchor":{"id":"a","\\u0069d":"b"}}')).toThrow("duplicate member");
  });
});
