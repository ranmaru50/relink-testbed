// tests/conformance/httpClient.test.ts

import { afterEach, describe, expect, it } from "vitest";
import { startHttpServer, type StartedHttpServer } from "../../src/server/createHttpServer.js";
import { FetchHttpClient } from "../../src/conformance/httpClient.js";

describe("FetchHttpClient", () => {
  const servers: StartedHttpServer[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });

  it("captures raw redirect responses instead of following them", async () => {
    const server = await startHttpServer((request, response) => {
      if (request.url === "/redirect") { response.writeHead(303, { location: "https://entity.example/description.arxml" }).end(); return; }
      response.writeHead(404).end();
    });
    servers.push(server);
    const response = await new FetchHttpClient().request({ url: `${server.origin}/redirect`, method: "GET" });
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe("https://entity.example/description.arxml");
  });
});
