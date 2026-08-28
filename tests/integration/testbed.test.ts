// tests/integration/testbed.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { startTestbed, type TestbedInstance } from "../../src/index.js";
import { createCaseDefinitions, validateCaseDefinition } from "../../src/cases/registry.js";

describe("RELink Testbed", () => {
  const instances: TestbedInstance[] = [];
  afterEach(async () => { await Promise.all(instances.splice(0).map(instance => instance.close())); });

  it("provides two ephemeral origins and the vertical slice", async () => {
    const testbed = await startTestbed(); instances.push(testbed);
    expect(testbed.entityOrigin).not.toBe(testbed.crossOrigin);
    const testCase = testbed.case("single-output-json");
    expect(testCase.documentUrl).toBe(`${testbed.entityOrigin}/arxml/valid/single-output-json.arxml`);
    expect((await fetch(testCase.documentUrl!)).status).toBe(200);
    expect(await (await fetch(new URL("/api/json/single", testbed.entityOrigin))).json()).toBe(20.1);
    expect(testbed.requests.last("json-single")?.pathname).toBe("/api/json/single");
  });

  it("records and resets POST JSON and GET queries per instance", async () => {
    const testbed = await startTestbed(); instances.push(testbed);
    await fetch(new URL("/api/json/echo", testbed.entityOrigin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "coffee" }) });
    await fetch(new URL("/api/json/single?query=coffee+maker&limit=10&available=true", testbed.entityOrigin));
    expect(testbed.requests.last("json-echo")?.json).toEqual({ query: "coffee" });
    expect(testbed.requests.last("json-single")?.query).toEqual({ query: ["coffee maker"], limit: ["10"], available: ["true"] });
    testbed.requests.reset();
    expect(testbed.requests.all()).toHaveLength(0);
  });

  it("preserves malformed responses, delay behavior, and CORS infrastructure", async () => {
    const testbed = await startTestbed(); instances.push(testbed);
    expect(await (await fetch(new URL("/api/representation/malformed-json", testbed.entityOrigin))).text()).toBe('{"temperature":');
    expect((await fetch(new URL("/api/status/500", testbed.entityOrigin))).status).toBe(500);
    const started = Date.now(); await fetch(new URL("/api/network/delay", testbed.entityOrigin));
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    const cors = await fetch(new URL("/cors/allowed", testbed.crossOrigin));
    expect(cors.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("supports repeated start and close cycles", async () => {
    const first = await startTestbed(); await first.close();
    const second = await startTestbed(); instances.push(second);
    expect((await fetch(new URL("/api/no-content", second.entityOrigin))).status).toBe(204);
  });

  it("exposes browser-readable, instance-local Harness diagnostics", async () => {
    const testbed = await startTestbed(); instances.push(testbed);
    const info = await (await fetch(new URL("/__testbed/info", testbed.entityOrigin))).json();
    expect(info).toMatchObject({ name: "RELink Testbed", entityOrigin: testbed.entityOrigin, crossOrigin: testbed.crossOrigin });
    const cases = await (await fetch(new URL("/__testbed/cases", testbed.entityOrigin))).json() as Array<{ id: string; documentUrl?: string }>;
    expect(cases.map(item => item.id)).toContain("single-output-json");
    expect(cases.find(item => item.id === "single-output-json")?.documentUrl).toBe(`${testbed.entityOrigin}/arxml/valid/single-output-json.arxml`);
    expect((await fetch(new URL("/__testbed/cases/unknown", testbed.entityOrigin))).status).toBe(404);
    await fetch(new URL("/api/json/single?a=1&a=2", testbed.entityOrigin));
    expect((await (await fetch(new URL("/__testbed/requests/json-single", testbed.entityOrigin))).json()) as unknown[]).toHaveLength(1);
    expect((await fetch(new URL("/__testbed/reset", testbed.entityOrigin), { method: "POST" })).status).toBe(204);
    expect((await (await fetch(new URL("/__testbed/requests", testbed.entityOrigin))).json()) as unknown[]).toHaveLength(0);
    const documentResponse = await fetch(testbed.case("single-output-json").documentUrl!);
    expect(documentResponse.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("exposes CORS only for baseline Harness capability endpoints", async () => {
    const testbed = await startTestbed(); instances.push(testbed);
    expect((await fetch(new URL("/api/json/single", testbed.entityOrigin))).headers.get("access-control-allow-origin")).toBe("*");
    expect((await fetch(new URL("/api/json/multi", testbed.entityOrigin))).headers.get("access-control-allow-origin")).toBe("*");
    expect((await fetch(new URL("/api/status/500", testbed.entityOrigin))).headers.get("access-control-allow-origin")).toBe("*");
    expect((await fetch(new URL("/api/representation/wrong-content-type", testbed.entityOrigin))).headers.get("access-control-allow-origin")).toBeNull();
    expect((await fetch(new URL("/cors/denied", testbed.crossOrigin))).headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows post-json preflight without recording it as a Capability request", async () => {
    const testbed = await startTestbed(); instances.push(testbed);
    const preflight = await fetch(new URL("/api/json/echo", testbed.entityOrigin), {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type"
      }
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("content-type");
    expect(testbed.requests.all()).toHaveLength(0);
  });

  it("preserves diagnostic request data and isolates reset per Testbed instance", async () => {
    const first = await startTestbed(); const second = await startTestbed(); instances.push(first, second);
    await fetch(new URL("/api/json/echo", first.entityOrigin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "coffee" }) });
    await fetch(new URL("/api/json/single?a=1&a=2", second.entityOrigin));
    const secondRequests = await (await fetch(new URL("/__testbed/requests/json-single", second.entityOrigin))).json() as Array<{ query: Record<string, string[]> }>;
    expect(secondRequests[0]?.query.a).toEqual(["1", "2"]);
    expect((await fetch(new URL("/__testbed/reset", first.entityOrigin))).status).toBe(404);
    expect((await (await fetch(new URL("/__testbed/requests", first.entityOrigin))).json()) as unknown[]).toHaveLength(1);
    await fetch(new URL("/__testbed/reset", first.entityOrigin), { method: "POST" });
    expect((await (await fetch(new URL("/__testbed/requests", first.entityOrigin))).json()) as unknown[]).toHaveLength(0);
    expect((await (await fetch(new URL("/__testbed/requests", second.entityOrigin))).json()) as unknown[]).toHaveLength(1);
  });

  it("rejects malformed and duplicate JSON case definitions", () => {
    expect(() => validateCaseDefinition({ id: "bad", group: "x", description: "x", document: 1, capabilityId: [], inputs: "bad", expected: null })).toThrow();
    const valid = { id: "duplicate", group: "x", description: "x", document: "/x", capabilityId: "x", inputs: {}, expected: {} };
    expect(() => createCaseDefinitions([valid, valid])).toThrow("Duplicate case ID");
  });
});
