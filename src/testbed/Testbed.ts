// src/testbed/Testbed.ts
import { createCapabilityHandler, createRequestHistory } from "../server/capability/createCapabilityHandler.js";
import { createCrossOriginHandler } from "../server/cross-origin/createCrossOriginHandler.js";
import { startHttpServer } from "../server/createHttpServer.js";
import { createEntityHandler } from "../server/entity/createEntityHandler.js";
import { requireCase, type TestbedInstance } from "./TestbedInstance.js";

/** Starts a local testbed with two independent origins. */
export async function startTestbed(): Promise<TestbedInstance> {
  const recorder = createRequestHistory();
  const entityServer = await startHttpServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://testbed.invalid").pathname;
    if (pathname.startsWith("/api/")) return createCapabilityHandler(recorder.record)(request, response);
    return createEntityHandler()(request, response);
  });
  try {
    const crossServer = await startHttpServer(createCrossOriginHandler());
    return {
      entityOrigin: entityServer.origin,
      crossOrigin: crossServer.origin,
      requests: recorder.history,
      case: id => {
        const definition = requireCase(id);
        return definition.documentPath === undefined
          ? definition
          : { ...definition, documentUrl: new URL(definition.documentPath, entityServer.origin).toString() };
      },
      close: async () => { await Promise.all([entityServer.close(), crossServer.close()]); }
    };
  } catch (error: unknown) { await entityServer.close(); throw error; }
}
