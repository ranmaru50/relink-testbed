// src/conformance/l2/stubResolverServer.ts
// Offline node:http stub of the L2 Resolver surface for L2-SRV conformance: an explicit
// fixture registry, the §6.1 status contract, the §6.2 authority material body, GET-only
// public surface, `p`/`l` fail-closed handling, cache policy bounded by remaining validity,
// and passive request logging. Ephemeral port, clean close, no external network.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type StubLifecycle = "ACTIVE" | "SUSPENDED" | "RETIRED" | "INTERNAL_ERROR" | "UNAVAILABLE";

export interface StubAnchorEntry {
  uuid: string;
  lifecycle: StubLifecycle;
  statementWire: string;
  records: string[];
}

export interface StubRequestLogEntry {
  method: string;
  path: string;
  query: Record<string, string>;
  uuid: string | null;
  endpoint: "statement" | "material" | "core" | "malformed";
  lookupPerformed: boolean;
  status: number;
}

export interface StubServerOptions {
  entries: readonly StubAnchorEntry[];
  servicePath?: string;
  includeReferrerPolicy?: boolean;
  immediateFreshness?: boolean;
  fixedT: number;
}

export interface StubResolverServer {
  baseUrl: string;
  log: () => StubRequestLogEntry[];
  close: () => Promise<void>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Extract the payload member object from a wire envelope string. */
export function wirePayloadObject(wire: string): Record<string, unknown> {
  const payloadText = wire.slice(wire.indexOf('{"payload":') + 11, wire.lastIndexOf(',"signature"'));
  return JSON.parse(payloadText) as Record<string, unknown>;
}

export async function startStubResolverServer(options: StubServerOptions): Promise<StubResolverServer> {
  const servicePath = options.servicePath ?? "relink";
  const referrer = options.includeReferrerPolicy ?? true;
  const immediate = options.immediateFreshness ?? false;
  const log: StubRequestLogEntry[] = [];
  const registry = new Map<string, StubAnchorEntry>();
  for (const entry of options.entries) {
    registry.set(entry.uuid, entry);
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams) {
      query[key] = value;
    }

    const segments = url.pathname.split("/").filter(segment => segment.length > 0);
    const pathSegments = segments[0] === servicePath ? segments.slice(1) : segments;
    const uuid = pathSegments[0] ?? null;
    const validUuid = uuid !== null && UUID_PATTERN.test(uuid);
    const isMaterial = pathSegments[1] === "authority";
    const endpoint: StubRequestLogEntry["endpoint"] = !validUuid ? "malformed" : isMaterial ? "material" : Object.keys(query).length === 0 ? "core" : "statement";

    const respond = (status: number, body: string, headers: Record<string, string>, lookupPerformed: boolean) => {
      log.push({ method: req.method ?? "GET", path: url.pathname, query, uuid: validUuid ? uuid : null, endpoint, lookupPerformed, status });
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(body);
    };

    const headers = (withReferrer: boolean, extra: Record<string, string> = {}): Record<string, string> => {
      const result: Record<string, string> = { ...extra };
      if (withReferrer) {
        result["Referrer-Policy"] = "no-referrer";
      }
      return result;
    };

    // §6.3 GET-only public surface: the method is rejected before any record lookup.
    if (req.method !== "GET") {
      respond(405, '{"error":"method not allowed"}', { "Allow": "GET" }, false);
      return;
    }

    if (!validUuid) {
      // Malformed Anchor UUID: 400 before lookup.
      respond(400, '{"error":"malformed anchor uuid"}', {}, false);
      return;
    }

    // Query parameters are not expanded beyond Core definitions; `p` has no L2 semantics
    // on the statement path, the material path takes no query, and unsupported l values
    // fail closed. All of these are answered before the record lookup.
    if (query["p"] !== undefined) {
      respond(400, '{"error":"unsupported p parameter"}', {}, false);
      return;
    }
    if (isMaterial && Object.keys(query).length > 0) {
      respond(400, '{"error":"query parameters are not accepted on the material surface"}', {}, false);
      return;
    }
    const l = query["l"];
    if (l !== undefined && l !== "2") {
      respond(400, '{"error":"unsupported l parameter"}', {}, false);
      return;
    }
    for (const key of Object.keys(query)) {
      if (key !== "l") {
        respond(400, '{"error":"unsupported query parameter"}', {}, false);
        return;
      }
    }

    const entry = registry.get(uuid as string);
    if (entry === undefined) {
      respond(404, '{"error":"not found"}', headers(referrer), true);
      return;
    }

    if (entry.lifecycle === "INTERNAL_ERROR") {
      respond(500, '{"error":"internal"}', headers(referrer), true);
      return;
    }
    if (entry.lifecycle === "UNAVAILABLE") {
      respond(503, '{"error":"unavailable"}', headers(referrer), true);
      return;
    }

    if (isMaterial) {
      const generations = entry.records.map(recordWire => wirePayloadObject(recordWire)["recordGeneration"] as number);
      const contiguous = generations.every((generation, index) => generation === index);
      if (entry.lifecycle === "RETIRED") {
        respond(410, '{"error":"gone"}', headers(referrer), true);
        return;
      }
      if (entry.lifecycle !== "ACTIVE" || generations.length === 0 || !contiguous) {
        // The material surface serves the contiguous ascending chain 0..G only; a chain
        // with a gap is not served as authority material.
        respond(404, '{"error":"not found"}', headers(referrer), true);
        return;
      }
      const lastWire = entry.records[entry.records.length - 1];
      if (lastWire === undefined) {
        respond(404, '{"error":"not found"}', headers(referrer), true);
        return;
      }
      const lastRecord = wirePayloadObject(lastWire);
      const remaining = (lastRecord["expiresAt"] as number) - options.fixedT;
      const cacheControl = immediate ? "no-store" : `public, max-age=${String(Math.max(0, remaining))}`;
      respond(200, `{"records":[${entry.records.join(",")}]}`, headers(referrer, { "Cache-Control": cacheControl }), true);
      return;
    }

    const statement = wirePayloadObject(entry.statementWire);
    const remaining = (statement["expiresAt"] as number) - options.fixedT;
    const cacheControl = immediate ? "no-store" : `public, max-age=${String(Math.max(0, remaining))}`;

    if (entry.lifecycle === "SUSPENDED") {
      respond(404, '{"error":"not found"}', headers(referrer), true);
      return;
    }
    if (entry.lifecycle === "RETIRED") {
      respond(410, '{"error":"gone"}', headers(referrer), true);
      return;
    }

    if (l === undefined) {
      // Core path (no l) is unchanged by L2: the 303 resolution path.
      respond(303, "", headers(referrer, { Location: statement["descriptionLocation"] as string, "Cache-Control": cacheControl }), true);
      return;
    }

    // L2 statement surface: the signed statement wire verbatim.
    respond(200, entry.statementWire, headers(referrer, { "Cache-Control": cacheControl }), true);
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;

  return {
    baseUrl,
    log: () => log.slice(),
    close: async () => {
      const closeAll = (server as { closeAllConnections?: () => void }).closeAllConnections;
      closeAll?.call(server);
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  };
}
