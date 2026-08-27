// src/server/entity/createEntityHandler.ts
import type { HttpHandler } from "../createHttpServer.js";
import { arxmlFixtures } from "./fixtures.js";

/** Creates a handler that serves Entity documents from the explicit registry only. */
export function createEntityHandler(): HttpHandler {
  return (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://testbed.invalid").pathname;
    if (pathname === "/arxml/edge/delay.arxml") {
      setTimeout(() => response.writeHead(200, { "content-type": "application/xml; charset=utf-8" }).end(arxmlFixtures["/arxml/valid/single-output-json.arxml"]), 1_000);
      return;
    }
    const fixture = arxmlFixtures[pathname];
    if (fixture === undefined) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": "application/xml; charset=utf-8" }).end(fixture);
  };
}
