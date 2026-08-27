// tests/integration/testbed.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { startTestbed, type TestbedInstance } from "../../src/index.js";

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
});
