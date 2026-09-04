# Resolver / Manifest Conformance Runner 0.1

本リポジトリには、Frozen Resolver / Manifest Conformance Catalog 0.1 に対する Testbed 側の実行可能 runner を収録します。runner は外部から観測可能な公開 Resolver、公開 Manifest endpoint、認証済み管理面を試験します。Resolver の PHP コードを import / 実行せず、SQLite の内部状態だけから適合性を判定しません。

試験対象として固定する実装は `ranmaru50/relink-resolver` の commit `4b08eead4bcc23374044bb60340bb915102a29db` です。Native と Container は別 profile ですが、同じ runner と正規化結果モデルを使用します。

## 実行

固定 Resolver の Native / Container deployment を、空のデータベースで起動します。各 deployment には管理用テストアカウントを設定してください。ローカル HTTP の開発 profile を使う場合は、Resolver の明示的な `RELINK_ADMIN_ALLOW_HTTP=1` を有効にします。本番 deployment では deployment edge で HTTPS を使用してください。

```powershell
$env:RELINK_NATIVE_URL = "http://127.0.0.1:8081"
$env:RELINK_CONTAINER_URL = "http://127.0.0.1:8080"
$env:RELINK_ADMIN_USERNAME = "admin"
$env:RELINK_ADMIN_PASSWORD = "テスト用の秘密値に置換"
pnpm conformance
```

runner は認証済み管理フォームを通じて、決定的な UUID fixture を登録します。再現可能な実行には新しいデータベースを使用してください。既存 fixture の state または Location が異なる場合、暗黙に上書きせずエラーにします。結果は次のように profile ごとに分けて出力されます。

```text
reports/resolver-conformance-0.1/native.json
reports/resolver-conformance-0.1/container.json
```

各結果には catalog version、target、case ID、normative strength、result class、観測した HTTP 情報、固定 Resolver commit が含まれます。複数 target に割り当てられた case は `(caseId, target)` ごとに1結果へ展開します。Resolver 全体を表す曖昧な PASS / FAIL は出力しません。

## 範囲と結果の解釈

runner は、該当する server、endpoint、producer、lifecycle、cache、CORS、identifier、Core / Manifest independence の case を実行します。redirect / network-policy enforcement、extension、resource limit、schema semantics、optional integrity verification など consumer 固有の case は、Reference Resolver 自体が consumer ではないため `NOT-APPLICABLE` として出力します。duplicate-member parsing も consumer target では `NOT-APPLICABLE` ですが、producer target では通常の parse 前に Manifest の生 JSON を検査します。これは失敗ではなく target の境界です。

`MNET-001` は profile URL が HTTPS なら `PASS` です。Manifest L1 retrieval は catalog の `MUST` なので、ローカル HTTP profile は `FAIL` になります。試験対象 profile に HTTPS 終端を用意してください。`CACHE-002` は `SHOULD` のため、catalog の既定値である 60 秒を使わない profile では `PASS-WITH-DEVIATION` になります。

runner は redirect を手動処理し、raw status、`Location`、cache / CORS header を観測可能にします。Description Location を追跡したり capability を実行したりしません。これにより Resolver / Runtime の境界を保ち、Resolver の成功応答を Entity description 取得の許可として扱いません。

実行可能 runner は、注入可能な local HTTP client を使って単体テストします。Container の実行 artifact は `reports/resolver-conformance-0.1/container.json` に commit しています。両 profile に対するコマンド実行は環境受入れ作業であり、固定 Resolver deployment が必要です。deployment 準備後の runner 自体はインターネットへ接続しません。Native 実行は Apache/PHP が利用可能な別環境で行う受入れ作業として残ります。
