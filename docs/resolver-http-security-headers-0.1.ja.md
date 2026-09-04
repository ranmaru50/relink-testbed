<!-- docs/resolver-http-security-headers-0.1.ja.md -->

# Resolver HTTP セキュリティヘッダー 0.1

本リポジトリには、Reference Resolver に追加された protocol-visible な HTTP hardening を Testbed 側で受け入れる runner を収録します。Frozen Resolver / Manifest Conformance Catalog 0.1 と、管理認証受入れ runner のいずれとも分離しています。

## 実装状態

runner の実装とレビューは commit `ca40b2d` で完了しており、最新レビューでは Blocking、P1、P2 がすべてありません。これは Testbed runner 基盤の完了を示すものであり、実 deployment の受入れ完了を示すものではありません。Issue #3 は Native HTTPS と Container の profile を実行し、raw observation artifact を commit するまで open のままです。

受入れ範囲は関連する Resolver 作業の [`relink-resolver#11`](https://github.com/ranmaru50/relink-resolver/issues/11) と [`relink-resolver#17`](https://github.com/ranmaru50/relink-resolver/pull/17) に対応しています。Resolver の conformance case を追加せず、Resolver の意味論も変更しません。

runner は Node.js の HTTP client を使用し、`IncomingMessage.rawHeaders` を保持します。header 名は大小文字を区別せず比較しますが、field の多重度は観測可能です。カンマで結合された値を、期待する単一 field が2つある状態と同等には扱いません。

## 確認内容

適用可能な各 response について、raw status、正規化 header、raw header field、body を記録します。次を確認します。

- `X-Content-Type-Options: nosniff` が単一 field であること;
- `Server` が未設定または許容された generic token `Apache`、`relink`、`relink-resolver` で、Apache/PHP の version や host の露出がなく、`X-Powered-By` がないこと;
- HTTPS では `Strict-Transport-Security: max-age=31536000` があり、HTTP/development response では HSTS がないこと;
- administrative response に `Cache-Control: no-store` と必須の `Content-Security-Policy` directive があること;
- public response の CORS と `Referrer-Policy: no-referrer` が維持されること;
- `TRACE` が HTTP 405 で拒否されること。

Native は HTTPS の public Resolver、Manifest、administrative login、Apache error path、TRACE、redirect、4xx、任意の5xx、HTTP development response を対象とします。Manifest には共通 hardening check だけを適用し、Resolver public 用の CORS / Referrer-Policy check は適用しません。Container は再現可能な 400、503、administrative 200、TRACE 405、任意の successful/redirect check を対象とします。

## 実行

各 transport を明示的に設定してください。`RELINK_NATIVE_URL` と `RELINK_CONTAINER_URL` は一方の transport の fallback として引き続き利用できますが、本番受入れでは以下の明示的な環境変数を使用してください。

```powershell
$env:RELINK_SECURITY_NATIVE_HTTPS_URL = "https://native.example"
$env:RELINK_SECURITY_NATIVE_HTTP_URL = "http://127.0.0.1:8081"
$env:RELINK_SECURITY_CONTAINER_HTTP_URL = "http://127.0.0.1:8080"
$env:RELINK_SECURITY_NATIVE_5XX_URL = "https://native.example/security/503"
$env:RELINK_SECURITY_CONTAINER_5XX_URL = "http://127.0.0.1:8080/security/503"
pnpm security:headers
```

結果は `reports/security-headers-0.1/native.json` と `reports/security-headers-0.1/container.json` に profile ごとに出力します。HTTPS/HTTP endpoint が未設定の場合は `NOT-APPLICABLE`、任意の5xx endpoint が未設定の場合は `UNSUPPORTED-OPTIONAL` です。どちらも deployment の合格を意味しません。

runner は Resolver の code を import せず、設定や database を調べず、redirect を追従せず、Description Location を取得せず、capability を実行しません。受入れ結果は設定された deployment の最終 wire response だけを根拠にします。
