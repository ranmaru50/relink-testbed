// src/conformance/profiles.ts

import { CONFORMANCE_CATALOG_VERSION } from "./catalog.js";
import type { ResolverProfile } from "./types.js";

const PINNED_RESOLVER_COMMIT = "4b08eead4bcc23374044bb60340bb915102a29db";

/** 環境変数から Native / Container の同値な Resolver profile を構築する。 */
export function loadResolverProfiles(environment: NodeJS.ProcessEnv = process.env): readonly ResolverProfile[] {
  const password = environment.RELINK_ADMIN_PASSWORD;
  if (password === undefined || password === "") throw new Error("RELINK_ADMIN_PASSWORD is required.");
  const profiles: ResolverProfile[] = [];
  for (const [name, variable] of [["native", "RELINK_NATIVE_URL"], ["container", "RELINK_CONTAINER_URL"]] as const) {
    const baseUrl = environment[variable];
    if (baseUrl === undefined || baseUrl === "") throw new Error(`${variable} is required.`);
    profiles.push({
      name,
      baseUrl: new URL(baseUrl).toString(),
      adminUsername: environment.RELINK_ADMIN_USERNAME ?? "admin",
      adminPassword: password,
      resolverCommit: environment.RELINK_RESOLVER_COMMIT ?? PINNED_RESOLVER_COMMIT,
      catalogVersion: CONFORMANCE_CATALOG_VERSION
    });
  }
  return profiles;
}

export { PINNED_RESOLVER_COMMIT };
