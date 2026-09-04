// src/security/profiles.ts

import type { SecurityProfile } from "./types.js";

/** 環境変数を正の整数へ変換し、受入れ待機時間の設定を構築する。 */
function positiveInteger(environment: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = Number(environment[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

/** Native / Container の管理認証セキュリティ profile を構築する。 */
export function loadSecurityProfiles(environment: NodeJS.ProcessEnv = process.env): readonly SecurityProfile[] {
  const password = environment.RELINK_ADMIN_PASSWORD;
  if (password === undefined || password === "") throw new Error("RELINK_ADMIN_PASSWORD is required.");
  const maxFailures = positiveInteger(environment, "RELINK_SECURITY_LOGIN_MAX_FAILURES", Number(environment.RELINK_ADMIN_LOGIN_MAX_FAILURES ?? 5));
  const lockoutSeconds = positiveInteger(environment, "RELINK_SECURITY_LOGIN_LOCKOUT_SECONDS", Number(environment.RELINK_ADMIN_LOGIN_LOCKOUT_SECONDS ?? 900));
  const idleSeconds = positiveInteger(environment, "RELINK_SECURITY_SESSION_IDLE_SECONDS", Number(environment.RELINK_ADMIN_SESSION_IDLE_SECONDS ?? 900));
  const absoluteSeconds = positiveInteger(environment, "RELINK_SECURITY_SESSION_ABSOLUTE_SECONDS", Number(environment.RELINK_ADMIN_SESSION_ABSOLUTE_SECONDS ?? 28_800));
  const waitGraceMilliseconds = positiveInteger(environment, "RELINK_SECURITY_WAIT_GRACE_MS", 250);
  const profiles: SecurityProfile[] = [];
  for (const [name, variable] of [["native", "RELINK_NATIVE_URL"], ["container", "RELINK_CONTAINER_URL"]] as const) {
    const baseUrl = environment[variable];
    if (baseUrl === undefined || baseUrl === "") throw new Error(`${variable} is required.`);
    profiles.push({
      name,
      baseUrl: new URL(baseUrl).toString(),
      adminUrl: environment.RELINK_SECURITY_ADMIN_URL,
      adminUsername: environment.RELINK_ADMIN_USERNAME ?? "admin",
      adminPassword: password,
      loginMaxFailures: maxFailures,
      loginLockoutSeconds: lockoutSeconds,
      sessionIdleSeconds: idleSeconds,
      sessionAbsoluteSeconds: absoluteSeconds,
      waitGraceMilliseconds,
      trustedProxyHeaders: {
        "x-forwarded-proto": "https",
        "x-forwarded-for": name === "native" ? "198.51.100.10" : "198.51.100.11"
      },
      untrustedProxyUrl: environment[`RELINK_SECURITY_${name.toUpperCase()}_UNTRUSTED_PROXY_URL`],
      sqliteEvidencePath: environment[`RELINK_SECURITY_${name.toUpperCase()}_SQLITE_EVIDENCE`]
    });
  }
  return profiles;
}
