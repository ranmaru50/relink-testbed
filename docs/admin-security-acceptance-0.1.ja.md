# 管理認証セキュリティ受入れ 0.1

本リポジトリには Resolver 管理面に対する Testbed 側の受入れ runner を収録します。Frozen Resolver / Manifest Conformance Catalog 0.1 とは分離しており、本書の `AUTH-*`、`SESSION-*`、`COOKIE-*`、`PROXY-*`、`SQLITE-*` は受入れ用ラベルであり、Frozen Catalog へ新しい case ID を追加するものではありません。

runner は Native と Container の結果を個別に記録します。HTTP 境界を観測し、Resolver の PHP コードを import せず、HTTP 適合性を推測するために Resolver の DB を読み取らず、Runtime への依存も追加しません。

## 対象範囲

HTTP case は次を対象とします。

- 1つの IP からの失敗の繰り返し、最初の失敗後の username 変更、lockout 期限、回復;
- 別 IP からの正規ログイン。IP を変更する分散攻撃はこの層の対象外;
- 正常ログイン、session ID rotation、session fixation 耐性、CSRF token 発行;
- idle / absolute session timeout と、期限後の管理画面・mutation request の拒否;
- `Secure`、`HttpOnly`、`SameSite=Strict` の session cookie 属性;
- trusted / untrusted proxy metadata。

`SQLITE-001` は Resolver 側の実 SQLite 受入れテストが生成する任意の JSON 証跡を読み取ります。次の boolean member がすべて `true` であることを要求します。

```json
{
  "concurrentAttempts": true,
  "expiredPurge": true,
  "boundedRows": true
}
```

これにより Testbed は SQLite の実装詳細から独立したまま、証跡が提供された場合に Native/Container 別の必須確認結果を記録できます。証跡ファイルが設定されていない場合、この case は `NOT-APPLICABLE` になります。

## 実行

timeout case を実用的な時間で実行できるよう、短い timeout を設定した使い捨ての Native / Container deployment を使用してください。Resolver の設定と runner の値は一致させる必要があります。

```powershell
$env:RELINK_NATIVE_URL = "http://127.0.0.1:8081"
$env:RELINK_CONTAINER_URL = "http://127.0.0.1:8080"
$env:RELINK_ADMIN_USERNAME = "admin"
$env:RELINK_ADMIN_PASSWORD = "テスト用の秘密値に置換"
$env:RELINK_ADMIN_ALLOW_HTTP = "1"
$env:RELINK_ADMIN_LOGIN_MAX_FAILURES = "2"
$env:RELINK_ADMIN_LOGIN_LOCKOUT_SECONDS = "2"
$env:RELINK_ADMIN_SESSION_IDLE_SECONDS = "2"
$env:RELINK_ADMIN_SESSION_ABSOLUTE_SECONDS = "3"
$env:RELINK_SECURITY_NATIVE_UNTRUSTED_PROXY_URL = "http://127.0.0.1:8082"
$env:RELINK_SECURITY_CONTAINER_UNTRUSTED_PROXY_URL = "http://127.0.0.1:8083"
pnpm security:acceptance
```

結果は次のように profile ごとに分けて出力されます。

```text
reports/admin-security-0.1/native.json
reports/admin-security-0.1/container.json
```

runner の実装、build、または実行が成功しても、Native / Container deployment の受入れが完了したことを意味しません。deployment の受入れ結果は、実際に設定された endpoint に対して生成した report によってのみ確定します。

untrusted proxy URL は、実際に untrusted な送信元から同じ deployment へ到達する必要があります。runner は client が送信した header を別の `REMOTE_ADDR` に変換できません。そのような endpoint が未設定の場合、`PROXY-001` は理由付きの `NOT-APPLICABLE` として記録されます。

timeout case は設定された期限を超えるまで意図的に待機します。使い捨ての受入れ deployment を使用し、本番の session store をこの command の対象にしないでください。
