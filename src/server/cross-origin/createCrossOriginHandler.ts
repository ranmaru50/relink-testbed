// src/server/cross-origin/createCrossOriginHandler.ts
import type { HttpHandler } from "../createHttpServer.js";

/** Creates a separate-origin handler for browser CORS verification. */
export function createCrossOriginHandler(): HttpHandler {
  return (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://testbed.invalid").pathname;
    const isAllowed = pathname === "/cors/allowed" || pathname === "/cors/preflight-allowed";
    if (isAllowed) response.setHeader("access-control-allow-origin", "*");
    if (pathname === "/cors/preflight-allowed" && request.method === "OPTIONS") {
      response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
      response.setHeader("access-control-allow-headers", "content-type");
      response.writeHead(204).end(); return;
    }
    if (pathname === "/cors/preflight-denied" && request.method === "OPTIONS") { response.writeHead(403).end(); return; }
    if (pathname === "/cors/allowed" || pathname === "/cors/denied" || pathname === "/cors/preflight-allowed" || pathname === "/cors/preflight-denied") {
      response.writeHead(200, { "content-type": "application/json" }).end("{\"ok\":true}"); return;
    }
    response.writeHead(404).end();
  };
}
