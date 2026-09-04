// src/security/catalog.ts

import type { SecurityCaseDefinition, SecurityCaseId } from "./types.js";

/** 管理認証セキュリティ受入れケースの正本。Frozen Catalog 0.1 へは追加しない。 */
export const securityCases: readonly SecurityCaseDefinition[] = [
  { id: "AUTH-001", scope: "http", description: "同一IPの失敗を累積し、username変更でもlockを回避できず、期限後に回復できる。" },
  { id: "AUTH-002", scope: "http", description: "別IPの正規ログインを許可し、IP変更による分散試行はこの層の対象外として記録する。" },
  { id: "SESSION-001", scope: "http", description: "正常ログインでsession IDをrotationし、CSRF tokenを発行する。" },
  { id: "SESSION-002", scope: "http", description: "idle / absolute timeout後に管理画面とmutationを拒否する。" },
  { id: "COOKIE-001", scope: "http", description: "管理session cookieのSecure / HttpOnly / SameSite=Strictを確認する。" },
  { id: "PROXY-001", scope: "http", description: "trusted proxy headerだけをHTTPS・client IP判定へ使用する。" },
  { id: "SQLITE-001", scope: "sqlite-evidence", description: "実SQLiteの並行試行、期限切れpurge、保存件数boundをResolver側証跡で確認する。" }
];

/** 安定IDから管理認証受入れケースを取得する。 */
export function findSecurityCase(caseId: SecurityCaseId): SecurityCaseDefinition {
  const testCase = securityCases.find(candidate => candidate.id === caseId);
  if (testCase === undefined) throw new Error(`Unknown security case: ${caseId}`);
  return testCase;
}
