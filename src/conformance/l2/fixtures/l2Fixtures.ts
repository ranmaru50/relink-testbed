// src/conformance/l2/fixtures/l2Fixtures.ts
// Loader for the pinned L2 0.1 test vectors (Catalog Appendix 10 / L2 spec Appendix A).
// The fixture file is copied byte-for-byte from the pinned source; nothing here re-signs
// or recomputes a pinned vector.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface L2KeyFixture {
  keyId: string;
  publicKey: string;
  publicHex: string;
  shaHex: string;
  seedString: string;
}

export interface L2VectorFixture {
  id: string;
  canonical: string;
  signature: string;
  signerPublicKey: string;
}

export interface L2FixturesConstants {
  SEED_STRING_1: string;
  KEY1_PRIVATE_SEED_HEX: string;
  KEY1_PUBLIC_HEX: string;
  KEY1_SHA256_HEX: string;
}

export interface L2Fixtures {
  l2Version: string;
  anchorId: string;
  entityId: string;
  timeT: number;
  freshnessWindowW: number;
  seeds: string[];
  constants: L2FixturesConstants;
  keys: Record<string, L2KeyFixture>;
  vectors: L2VectorFixture[];
}

const fixturesPath = fileURLToPath(new URL("./l2-fixtures.json", import.meta.url));

export const l2Fixtures: L2Fixtures = JSON.parse(readFileSync(fixturesPath, "utf8")) as L2Fixtures;

export function l2Vector(id: string): L2VectorFixture {
  for (const vector of l2Fixtures.vectors) {
    if (vector.id === id) {
      return vector;
    }
  }
  throw new Error(`pinned L2 vector not found: ${id}`);
}

export function l2Key(name: string): L2KeyFixture {
  const key = l2Fixtures.keys[name];
  if (key === undefined) {
    throw new Error(`pinned L2 key fixture not found: ${name}`);
  }
  return key;
}

export function l2KeyByPublicHex(publicHex: string): L2KeyFixture {
  for (const name of Object.keys(l2Fixtures.keys)) {
    const key = l2Fixtures.keys[name];
    if (key !== undefined && key.publicHex === publicHex) {
      return key;
    }
  }
  throw new Error(`pinned L2 key fixture not found for publicKey: ${publicHex}`);
}

export function l2WireEnvelope(vectorId: string): string {
  const vector = l2Vector(vectorId);
  return `{"payload":${vector.canonical},"signature":"${vector.signature}"}`;
}
