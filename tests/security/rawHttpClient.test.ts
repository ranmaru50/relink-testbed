// tests/security/rawHttpClient.test.ts

import { afterEach, describe, expect, it } from "vitest";
import { RawSecurityHttpClient } from "../../src/security/rawHttpClient.js";
import { startHttpServer, type StartedHttpServer } from "../../src/server/createHttpServer.js";

describe("RawSecurityHttpClient", () => {
  const servers: StartedHttpServer[] = [];

  afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });

  it("Node.js の rawHeaders から同名 field の重複を保持する", async () => {
    const server = await startHttpServer((_request, response) => {
      response.setHeader("X-Content-Type-Options", ["nosniff", "nosniff"]);
      response.end();
    });
    servers.push(server);

    const response = await new RawSecurityHttpClient().request({ url: server.origin });
    expect(response.status).toBe(200);
    expect(response.rawHeaders.filter(header => header.name.toLowerCase() === "x-content-type-options")).toHaveLength(2);
    expect(response.headers["x-content-type-options"]).toBe("nosniff, nosniff");
  });

  it("response body の上限超過を reject する", async () => {
    const server = await startHttpServer((_request, response) => { response.end("0123456789"); });
    servers.push(server);

    await expect(new RawSecurityHttpClient({ maxBodyBytes: 4 }).request({ url: server.origin })).rejects.toThrow("exceeded 4 bytes");
  });

  it("response が終了しない場合に request timeout で reject する", async () => {
    const server = await startHttpServer((_request, response) => { response.write("partial"); });
    servers.push(server);

    await expect(new RawSecurityHttpClient({ timeoutMilliseconds: 25 }).request({ url: server.origin })).rejects.toThrow("timed out after 25 ms");
  });
});
