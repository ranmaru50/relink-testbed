// src/security/headerProfiles.ts

import type { HeaderSecurityProfile } from "./headerTypes.js";

/** 環境変数の空文字を未設定として扱う。 */
function optional(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = environment[name];
  return value === undefined || value === "" ? undefined : value;
}

/** URL を検証し、HTTP client が扱える absolute URL に正規化する。 */
function absoluteUrl(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
}

/** Native / Container の HTTP header 受入れ profile を構築する。 */
export function loadHeaderSecurityProfiles(environment: NodeJS.ProcessEnv = process.env): readonly HeaderSecurityProfile[] {
  const profiles: HeaderSecurityProfile[] = [];
  for (const name of ["native", "container"] as const) {
    const upperName = name.toUpperCase();
    const configuredBaseUrl = optional(environment, `RELINK_${upperName}_URL`);
    const httpsUrl = absoluteUrl(optional(environment, `RELINK_SECURITY_${upperName}_HTTPS_URL`) ?? (configuredBaseUrl?.startsWith("https:") === true ? configuredBaseUrl : undefined), `RELINK_SECURITY_${upperName}_HTTPS_URL`);
    const httpUrl = absoluteUrl(optional(environment, `RELINK_SECURITY_${upperName}_HTTP_URL`) ?? (configuredBaseUrl?.startsWith("http:") === true ? configuredBaseUrl : undefined), `RELINK_SECURITY_${upperName}_HTTP_URL`);
    profiles.push({
      name,
      httpsUrl,
      httpUrl,
      publicPath: optional(environment, "RELINK_SECURITY_PUBLIC_PATH") ?? "/relink/550e8400-e29b-41d4-a716-446655440000",
      manifestPath: optional(environment, "RELINK_SECURITY_MANIFEST_PATH") ?? "/relink/550e8400-e29b-41d4-a716-446655440000/manifest",
      adminPath: optional(environment, "RELINK_SECURITY_ADMIN_PATH") ?? "/admin.php",
      apacheErrorPath: optional(environment, "RELINK_SECURITY_APACHE_ERROR_PATH") ?? "/__security__/apache-error",
      tracePath: optional(environment, "RELINK_SECURITY_TRACE_PATH") ?? "/relink/550e8400-e29b-41d4-a716-446655440000",
      clientErrorPath: optional(environment, "RELINK_SECURITY_CLIENT_ERROR_PATH") ?? "/relink/not-a-uuid",
      serverErrorUrl: absoluteUrl(optional(environment, `RELINK_SECURITY_${upperName}_5XX_URL`), `RELINK_SECURITY_${upperName}_5XX_URL`)
    });
  }
  return profiles;
}
