// src/server/createHttpServer.ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/** Public HTTP request handler type. */
export type HttpHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

/** Started local HTTP server. */
export interface StartedHttpServer {
  readonly origin: string;
  close(): Promise<void>;
}

/** Starts a localhost-only HTTP server on an ephemeral port. */
export async function startHttpServer(handler: HttpHandler): Promise<StartedHttpServer> {
  const server: Server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Failed to resolve the HTTP server port.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}
