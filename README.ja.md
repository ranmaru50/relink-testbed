# RELink Testbed

AR-XML ランタイムおよび将来の RELink プロトコル部品を検証する、ローカル自動テスト環境です。

RELink Testbed は、複数のランタイム実装で共有できる再現可能なフィクスチャ、プロトコルシナリオ、期待結果を提供します。

初期の焦点は **AR-XML Core 0.1 Draft 4 Web Runtime ベースライン**です。将来は Resolver、Manifest、Trust、追加のランタイム実装へ拡張します。

---

## 目的

RELink Testbed は、次の問いに答えるために存在します。

> RELink / AR-XML の実装は、同じ観測可能なテストケースに対して一貫して動作するか。

プロトコルテストを一つのランタイムリポジトリへ埋め込む代わりに、次の実装で再利用できる独立環境を提供します。

- Web ランタイム
- Python ランタイム
- Kotlin / モバイルランタイム
- .NET ランタイム
- 将来のヘッドレス・組込み・ロボティクスランタイム

目的はすべての本番配備の詳細を再現することではありません。プロトコル、意味論、相互運用性の検証のために、小さく、決定的で、ローカル実行可能な環境を提供することです。

---

## 初期スコープ

最初の版は AR-XML Core 0.1 Draft 4 の処理ベースラインを対象にします。

```text
Fetch
→ Parse
→ Validate
→ Resolve
→ Evaluate
→ Invoke
→ Decode
→ Map
→ Expose Result
```

環境は次のシナリオをサポートします。

- AR-XML 文書の取得
- 有効および不正な XML
- Core 構造検証
- 相対 endpoint の解決
- HTTP GET 入力の直列化
- HTTP POST JSON 入力の直列化
- HTTP 2xx の挙動
- HTTP 204 の挙動
- JSON 結果のデコード
- テキスト結果のデコード
- バイナリ／メディア結果の処理
- 単一出力のマッピング
- 複数 JSON 出力のマッピング
- 不正応答
- 不正な `Content-Type`
- 遅延応答
- キャンセル
- ランタイムのネットワークポリシー挙動
- クロスオリジンシナリオ
- 実ブラウザーでの CORS 挙動
- 層別のエラー分類
- Contract / Projection / Availability 状態

---

## 外部 Web Runtime Test Harness

外部のブラウザー型 Harness は、Runtime に Testbed を組み込むことなく利用できます。Harness は機械可読なケースメタデータを取得し、AR-XML 文書 URL を Runtime に渡し、ユーザーが Capability を呼び出した後で受動的なリクエスト観測結果を取得します。

```text
Browser Harness
   │
   ├─ Web Runtime
   │      │
   │      └── AR-XML / Capability HTTP ──┐
   │                                      │
   └── Diagnostic API ────────────────────┤
                                          ▼
                                     RELink Testbed
```

Testbed は `pnpm dev` で起動します。エフェメラルな localhost ポートを使用し、Entity、Cross-Origin、診断 API の URL を表示します。Testbed 自身は Runtime を実行せず、Runtime 固有の結果報告も要求しません。

診断エンドポイントは Entity Origin の `/__testbed/*` 配下にあります。

- `GET /__testbed/info`
- `GET /__testbed/cases`
- `GET /__testbed/cases/{id}`
- `GET /__testbed/requests`
- `GET /__testbed/requests/{endpointId}`
- `POST /__testbed/reset`

これらの診断 API、ベースラインの AR-XML 文書、ベースライン Harness の Capability endpoint は、許可的な CORS によりブラウザーから読み取れます。一方、Capability の CORS 挙動はシナリオ固有のままであり、拒否シナリオを許可的にはしません。

現在 Harness が対応するケースは `single-output-json`、`multi-output-json`、`post-json`、`http-204-no-output`、`relative-endpoint-invocable`、`http-500`、`malformed-json` です。ランタイム非依存のメタデータは `cases/**/*.json` に格納します。

## Resolver / Manifest 適合性

実行可能な Resolver / Manifest 0.1 runner については [docs/resolver-conformance-0.1.ja.md](docs/resolver-conformance-0.1.ja.md) を参照してください。Native と Container を別々に設定した profile に対して target ごとの case を実行し、raw HTTP 観測値を記録します。結果を曖昧な Resolver 全体の結果へ統合せず、正規化した JSON を出力します。

管理認証のセキュリティ受入れは実装済みで、[docs/admin-security-acceptance-0.1.ja.md](docs/admin-security-acceptance-0.1.ja.md) に記載しています。Frozen Catalog に case を追加せず、ログイン乱用対策、セッション制御、CSRF、Cookie 属性、trusted proxy metadata、任意の Resolver 側 SQLite 証跡について Native と Container の観測結果を個別に記録します。リポジトリの実装完了と実 deployment の受入れ完了は別に扱います。

Resolver HTTP セキュリティヘッダーの受入れ runner は実装・レビュー・文書化が完了しており、[docs/resolver-http-security-headers-0.1.ja.md](docs/resolver-http-security-headers-0.1.ja.md) に記載しています。重複 field を含む raw status / header を保持し、Native の HTTPS/HTTP 境界と Container の error、administrative、TRACE、代表的な redirect scenario を確認します。明示的に設定した deployment endpoint に対して `pnpm security:headers` で実行できます。実 Native HTTPS / Container 受入れと raw observation artifact の commit は、引き続き別の open な deployment 作業です。

## Resolver L2 適合性

Resolver L2 0.1-draft 適合性スイートは `src/conformance/l2/` 配下に実装されています。`L2_CONFORMANCE_CATALOG_VERSION = "0.1-draft"` の 91 の catalog case を、`L2-SERVER` / `L2-PRODUCER` / `L2-VERIFIER` / `L2-AUTHORITY` の 4 つの target で扱います。L1 catalog は frozen のまま変更せず、L2 catalog は別ファイルです。L1 の `pnpm conformance` entrypoint も変更していません。

Pinned fixtures: `src/conformance/l2/fixtures/l2-fixtures.json` は 28 の pinned canonical payload vector、5 つの ed25519 key pair（seed string から PKCS#8 seed が決定的に導出されます）、固定時計（T = 1769998400、W = 600）を持ちます。Fixtures は runtime 非依存です。すべての canonical string、signature、keyId は byte-for-byte に再導出され、pinned vector を再署名・改変することはありません。

Verifier は §15.2 の phase 1〜11 を実装しています: wire の canonical 性厳密 parse、anchor binding、algorithm、trusted clock、chain walk（§9.6、§12.2 の transfer trail を含む）、revocation snapshot、Record chain position、canonical payload bytes に対する signature、key state（§9.5）、freshness・floor・replay、そして L1-bound observation（§7.4）です。Record と statement の negative variant は、pinned vector に対する canonical を保つ string surgery、または fixture seed で変異 payload を再署名して作成します。

実行方法:

```bash
pnpm tsx src/conformance/l2/run.ts
```

`reports/resolver-l2-0.1-draft/<profile>.json` に書き出します。deployment URL が設定されていない場合、runner は offline の stub Resolver サーバー（`node:http`、ephemeral port、明示的な fixture registry、クリーンに close）を L2-SRV case に使います。L2-SRV handler を実 deployment へ向けるには、環境変数 `RELINK_NATIVE_URL`（profile `native`）または `RELINK_CONTAINER_URL`（profile `container`）を設定します。同じ runner と同じ 91 の handler が real base URL を駆動します。これは L1 runner が `src/conformance/profiles.ts` を通じて行うのと同じ仕組みです。

`pnpm test` は `tests/conformance/` 配下の L2 vitest スイートを実行します: fixtures 自己整合性、L2-VER、L2-AUT、L2-PRO、L2-SRV、そして coverage test（91 の catalog case id すべてが id を名前に含む test title でカバーされ、coverage map に unknown id がないことを検証）。Coverage map は `tests/conformance/l2-coverage.ts` です。

既知の baseline deviation は report に記録します: ES256 サポート（L2-PRO-012）と statement revocation（L2-VER-045）は `UNSUPPORTED-OPTIONAL`、SHOULD レベルの `Referrer-Policy: no-referrer` header を省略した deployment は `PASS-WITH-DEVIATION`（L2-SRV-006）として記録されます。

---

## 設計目標

### ローカルファースト

完全なベースライン環境は外部クラウドサービスを必要とせず、開発者のマシンで実行できる必要があります。

```bash
pnpm install
pnpm test
```

テストランナーは必要なローカルサーバーを自動的に起動・停止できる必要があります。

### 決定性

テストケースは再現可能な挙動を提供し、公開 API、第三者サービス、不安定な外部ネットワーク、共有リモート状態を避けます。

### ランタイム非依存

フィクスチャと期待結果は TypeScript や特定ランタイムの API に依存しません。同じシナリオを Web、Python、Kotlin、.NET ランタイムで再利用できるようにします。

### プロトコル重視

テストベッドは内部実装構造ではなく、観測可能なプロトコルおよび意味論上の挙動を検証します。

### 拡張性

初期の AR-XML テストサーバーは、完全な再設計なしでより広範な RELink プロトコルテスト環境へ成長できる必要があります。

---

## 提案アーキテクチャ

```text
RELink Testbed
│
├─ Test Runner
├─ Entity Server
│  ├─ AR-XML fixtures
│  └─ document retrieval scenarios
├─ Capability Server
│  ├─ success responses
│  ├─ error responses
│  ├─ malformed responses
│  ├─ delayed responses
│  └─ request inspection
├─ Cross-Origin Server
│  └─ CORS / origin scenarios
├─ Test Cases
│  ├─ input
│  ├─ expected request
│  ├─ expected runtime state
│  └─ expected result / error
└─ Future Services
   ├─ Resolver
   ├─ Manifest
   ├─ Trust
   └─ Identity scenarios
```

初期実装では複数の論理サービスを一つの Node.js プロセス内で動かしても構いません。ただし論理的に分離し、独立した Origin には別のエフェメラルポートを使います。

---

## テストサーバー戦略

初期実装ではフルスタックの Web フレームワークではなく Node.js 組み込み HTTP サーバーを優先します。これにより次を直接制御できます。

- 応答ステータス
- ヘッダー
- 不正な本文
- 遅延応答
- 接続終了
- リダイレクト
- CORS ヘッダー
- リクエスト記録

```text
Origin A: Entity / AR-XML documents
Origin B: Cross-origin capability endpoint
Origin C: Future Resolver service
```

ポートは通常 OS が動的に割り当て、競合を避け、並列テストを改善します。

---

## テストケースモデル

テストケースは可能な限り機械可読にします。概念例は以下です。

```json
{
  "id": "single-output-json",
  "document": "/arxml/single-output-json.arxml",
  "expected": {
    "contractResolution": "UNRESOLVED",
    "projectionValidation": "UNVALIDATED",
    "availability": "READY",
    "invocation": {
      "status": "success",
      "representation": "application/json",
      "values": { "temperature": 20.1 }
    }
  }
}
```

正確なスキーマは未確定です。ケースは私的な実装詳細ではなく期待される観測可能な挙動を記述します。

---

## 想定シナリオグループ

```text
cases/
├─ document/  ─ valid, malformed-xml, invalid-arxml
├─ request/   ─ get-query, post-json, relative-endpoint
├─ response/  ─ single-output-json, multi-output-json, text, binary, no-content, malformed-json, wrong-content-type
├─ http/      ─ 400, 401, 403, 404, 500
├─ runtime/   ─ abort, unresolved-contract, projection-conflict
└─ security/  ─ same-origin, cross-origin-allowed, cross-origin-denied
```

この構造は例示であり、実装に合わせて変更される場合があります。

---

## ブラウザー固有の検証

Node.js の HTTP クライアントはブラウザーの CORS 規則を強制しません。そのためブラウザー固有のセキュリティ挙動は実ブラウザー環境で別途テストします。将来の Playwright 層は次を扱えます。

- CORS 拒否
- プリフライト挙動
- ブラウザー資格情報ポリシー
- ブラウザー fetch 挙動

大半のプロトコル・意味論テストは、ブラウザーを起動せずに実行可能なままとします。

---

## 将来の Resolver テスト

Resolver テストも同じテストベッドを使う予定です。

```text
Anchor / Identifier → Resolver Service → Entity Identity / AR-XML Location → AR-XML Runtime → Capability Invocation
```

Resolver は AR-XML Runtime および Entity Server から独立した論理サービスとします。成功解決、未知エンティティ、古いマッピング、移動した AR-XML 文書、ライフサイクル状態、Resolver 障害、キャッシュ、Manifest 発見、Trust メタデータを将来のシナリオとします。実 DNS、TLS 証明書チェーン、NFC、BLE、ネットワークフェイルオーバーは追加環境を必要とする場合があります。

---

## ランタイムリポジトリとの関係

RELink Testbed はランタイム実装ではありません。ランタイムリポジトリが実行できる共有の外部テストシナリオを提供します。時間の経過とともに、同じフィクスチャと期待結果は **AR-XML 適合性テストスイート** の基礎となり得ます。

---

## 非目標

初期版で提供しないものは次のとおりです。

- 本番ホスティング
- 性能ベンチマーク
- インターネット規模の Resolver 基盤
- 認証サービス
- 公開相互運用基盤
- ハードウェアシミュレーション
- 完全なネットワーク障害エミュレーション
- 完全な TLS / PKI テスト
- NFC / BLE ハードウェアテスト

必要になった場合、これらは別のテスト層として追加できます。

---

## プロジェクトの状態

**実験的／初期開発段階**

このプロジェクトは AR-XML Core と RELink Runtime の開発と並行して作成されています。仕様が進化している間は、テストスキーマ、ディレクトリ構造、サーバー API、シナリオ定義が変更される場合があります。

---

## ライセンス

ライセンスはリポジトリ所有者が定めます。他の RELink ランタイム実装とともに公開する場合、実装コードには Apache License 2.0 が適切な既定候補です。

---

## RELink

RELink は **Real Entity Link** の略です。より広い目標は、既存の Web 基盤を可能な限り利用して実世界のエンティティを次の状態にすることです。

```text
Addressable
→ Discoverable
→ Interactable
→ Operable
```

RELink Testbed は、そのアーキテクチャを検証する共有の実験環境を提供します。
