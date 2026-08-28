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
