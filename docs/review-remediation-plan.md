# docs/review-remediation-plan.md

# RELink Testbed レビュー指摘事項の是正計画

## 目的

本書は、初期実装に対するレビュー指摘を優先度順に整理し、各対応が完了したことを第三者が確認できる受入条件と確認手順を定義する。

対象は RELink Testbed であり、Web Runtime 自体の実装変更は対象外とする。ただし、P4 では外部 Runtime を用いた接続試験を追加する。

## 優先度の定義

| 優先度 | 意味 | 次工程への影響 |
| --- | --- | --- |
| P0 | Testbed の正しさを損なう問題 | 解消前に Runtime 接続試験を開始しない |
| P1 | 相互運用性またはケースの信頼性を損なう問題 | P0 完了後、同一マイルストーンで対応する |
| P2 | 試験範囲の誤認や保守性を損なう問題 | P1 完了後に対応する |
| P3 | 将来の保守性を改善する問題 | 基本機能の完了後に対応する |

## 対応一覧

| ID | 優先度 | 指摘事項 | 対応方針 | 完了条件 |
| --- | --- | --- | --- | --- |
| R-001 | P0 | `valid` AR-XML フィクスチャが Draft 4 の構文ではない | Draft 4 を正本として全フィクスチャを再作成する | 有効フィクスチャが `ar-entity`、名前空間、`capabilities`、`result`、`interfaces/interface` を使う |
| R-002 | P1 | ケース定義の正本が JSON と TypeScript に二重化している | `cases/**/*.json` を唯一の正本とし、TypeScript は Loader / Validator とする | TypeScript のハードコード配列がなく、JSON から全ケースを取得できる |
| R-003 | P1 | 相対 endpoint が Capability endpoint に到達しない | resolution-only と invocable を別ケースにし、期待解決 URL を明示する | 各ケースの解決 URL と HTTP 到達性をテストする |
| R-004 | P2 | 登録済みケースと実行済みケースが一致しない | 実行可能なケースだけを registry に登録する | registry の各ケースに対応するテストが存在する |
| R-005 | P2 | 実 Runtime に接続する E2E 試験がない | relink-web-runtime を Testbed に接続する試験を追加する | Draft 4 文書取得から Capability 結果の公開までが実 Runtime で通る |
| R-006 | P3 | Capability handler が肥大化する見込み | シナリオ単位の route モジュールに分割する | success / status / representation / network が独立モジュールとなる |

## R-001: Draft 4 準拠フィクスチャ

### 対応内容

`fixtures/arxml/valid/`、`fixtures/arxml/invalid/`、`fixtures/arxml/edge/` を Draft 4 の実構文に合わせる。有効フィクスチャは少なくとも次の構造を持つ。

```xml
<ar-entity xmlns="https://relink.dev/ns/arxml/core/0.1" version="0.1">
  <capabilities>
    <capability id="..." type="...">
      <result>...</result>
      <interfaces>
        <interface type="http" method="GET" endpoint="..." />
      </interfaces>
    </capability>
  </capabilities>
</ar-entity>
```

無効フィクスチャは、意図した検証失敗点以外は Draft 4 の構造を保つ。一つのフィクスチャには一つの主題だけを含める。

### 反映確認

1. 有効・無効・edge の全フィクスチャを一覧化する。
2. 各フィクスチャについて、意図した差分と Draft 4 上の期待結果をテストケース JSON に記載する。
3. Draft 4 Web Runtime による取得・解析テストを実行し、有効フィクスチャが解析可能であることを確認する。
4. `pnpm test`、`pnpm typecheck`、`pnpm build` が成功することを確認する。

## R-002: JSON ケース定義への一本化

### 対応内容

ケースの ID、グループ、説明、文書パス、期待結果は `cases/**/*.json` にのみ記述する。TypeScript は JSON を読み込み、構造を検証し、公開 API 用の型へ変換する。JSON のフィールド名は `document` に統一する。

### 反映確認

1. `src/cases/registry.ts` にケースのハードコード配列が存在しないことを確認する。
2. JSON の ID 重複、必須フィールド不足、不正な型を検出する Loader のテストを追加する。
3. `testbed.case("single-output-json")` が JSON に定義された文書 URL と期待結果を返すことを確認する。
4. JSON 以外へケース本文を二重記載していないことを `rg "single-output-json" src/cases cases` で確認する。

## R-003: 相対 endpoint ケースの整理

### 対応内容

URL 解決のみを検証するケースと、実際に Capability を呼び出すケースを分離する。

- resolution-only: 文書 URL と endpoint から期待解決 URL を metadata に記載し、HTTP 到達は要求しない。
- invocable: 文書配置と相対 endpoint を調整し、解決結果が `/api/*` の実在する endpoint となるようにする。

### 反映確認

1. root-relative、path-relative、parent-relative の各ケースに期待解決 URL を記載する。
2. invocable ケースについて `new URL(endpoint, documentUrl)` が Capability endpoint と一致することをテストする。
3. 解決後の URL に fetch し、期待したステータスと本文を確認する。

## R-004: 登録ケースと実行ケースの一致

### 対応内容

未実装のケースは registry に登録しない。ケースを追加するプルリクエストには、対応するテストを同時に追加する。ケースが将来向けの設計資料だけである場合は registry ではなく設計文書に記載する。

### 反映確認

1. registry のケース ID ごとに、対応するテスト名またはテストデータを対応表で確認する。
2. ケースを走査するテストを追加し、未対応の ID があれば失敗するようにする。
3. `pnpm test` の結果に登録ケース数と実行済みケース数の差がないことを確認する。

## R-005: Draft 4 Web Runtime E2E 試験

### 前提条件

対象となる `relink-web-runtime` のリポジトリパス、起動方法、公開 API、依存関係の取得方法を明確にする。これらが未確定の場合、本項目は着手しない。

### 対応内容

Testbed を起動し、Web Runtime に Draft 4 の有効フィクスチャ URL を渡す。Runtime が文書を取得・解析・解決・呼出し・デコード・結果公開まで行うことを検証する。

### 反映確認

1. `single-output-json` で Runtime の結果が `temperature: 20.1` となることを確認する。
2. `post-json` で Testbed の記録した JSON 本文が期待した入力マッピングと一致することを確認する。
3. 不正 XML、HTTP 500、不正 JSON の各ケースで Runtime が期待した失敗として扱うことを確認する。
4. E2E 試験は外部ネットワークおよび固定ポートに依存しないことを確認する。

## R-006: Capability handler の分割

### 対応内容

Capability route を次の責務ごとに分割する。

```text
capability/
├─ createCapabilityHandler.ts
├─ successRoutes.ts
├─ statusRoutes.ts
├─ representationRoutes.ts
└─ networkRoutes.ts
```

共有するリクエスト記録とルーティングだけを `createCapabilityHandler.ts` に残す。

### 反映確認

1. 既存 endpoint の URL、ステータス、ヘッダー、本文が変更されていないことをテストする。
2. 各 route モジュールを単独でテストできることを確認する。
3. `pnpm test`、`pnpm typecheck`、`pnpm build` が成功することを確認する。

## 実施順序とマイルストーン

1. R-001 を完了し、Draft 4 に対するフィクスチャの正しさを確立する。
2. R-002 と R-003 を完了し、ランタイム非依存なケース定義と URL 解決の意味を確立する。
3. R-004 を完了し、登録済みケースが実行可能であることを保証する。
4. R-005 を完了し、Web Runtime との最初の E2E マイルストーンを達成する。
5. R-006 を必要に応じて実施し、ケース追加時の保守性を維持する。

各項目の完了時には、該当する反映確認を実施し、実行コマンドと結果を変更記録またはプルリクエストに残す。
