// src/testbed/Testbed.ts
import { createCapabilityHandler, createRequestHistory } from "../server/capability/createCapabilityHandler.js";
import { caseDefinitions } from "../cases/registry.js";
import { createCrossOriginHandler } from "../server/cross-origin/createCrossOriginHandler.js";
import { startHttpServer } from "../server/createHttpServer.js";
import { createEntityHandler } from "../server/entity/createEntityHandler.js";
import { createDiagnosticsHandler } from "../server/diagnostics/createDiagnosticsHandler.js";
import { requireCase, type TestbedInstance } from "./TestbedInstance.js";

/** Starts a local testbed with two independent origins. */
export async function startTestbed(): Promise<TestbedInstance> {
  const recorder = createRequestHistory();
  let entityOrigin = "";
  let crossOrigin = "";
  const resolveCases = () => caseDefinitions.map(definition => definition.document === undefined ? definition : { ...definition, documentUrl: new URL(definition.document, entityOrigin).toString() });
  const entityServer = await startHttpServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://testbed.invalid").pathname;
    if (pathname.startsWith("/__testbed/")) return createDiagnosticsHandler({ entityOrigin, crossOrigin, cases: resolveCases, requests: recorder.history })(request, response);
    if (pathname.startsWith("/api/")) return createCapabilityHandler(recorder.record)(request, response);
    return createEntityHandler()(request, response);
  });
  try {
    const crossServer = await startHttpServer(createCrossOriginHandler());
    entityOrigin = entityServer.origin;
    crossOrigin = crossServer.origin;
    return {
      entityOrigin,
      crossOrigin,
      requests: recorder.history,
      case: id => {
        const definition = requireCase(id);
        return resolveCases().find(testCase => testCase.id === id) ?? definition;
      },
      close: async () => { await Promise.all([entityServer.close(), crossServer.close()]); }
    };
  } catch (error: unknown) { await entityServer.close(); throw error; }
}
