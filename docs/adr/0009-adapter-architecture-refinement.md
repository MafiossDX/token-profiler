---
status: accepted
---

# Adapter architecture refinement: three-layer stack, confidence×availability axes, Core Task authority stays with wrap

> 実装状況: 3層 seam はコードに反映済み。`src/launch/`(Client Launch Adapter — env var / target host / protocol / enrichment を解決。`ClientLaunchProfile`)、`src/protocol/`(Provider Protocol — `ProviderProtocol` interface + `anthropic-messages`。method/path で shape 判定)、`src/enrichment/`(Client Enrichment — `claude-code` の thread identity、`system-reminder` の split。層の contract 型は `src/enrichment/types.ts`: `ThreadMarker` / `AdapterCapability`)、`src/core/`(provider 非依存の Core Measurement)。合流点は `src/recorder.ts`(enrichment は launch profile から注入)。旧 `src/adapters/` は廃止。未着手: full Transport 分離(HTTP forwarding と MeasurementSink の明示的 seam 化)は 2つ目の Transport(WebSocket / Codex)が来た時点で行う。

ADR-0005/0006/0008 を実装可能な粒度まで詰めた結果、3つの粗さが見つかった。

1. ADR-0005 の `ClientAdapter` インターフェースに `identifyTask(request)` があるが、ADR-0001/0007 は Task identity の権威を `wrap` だけに置いている。Adapter が request から `identifyTask` できるという書き方は、将来 Adapter が `task_id` を発行できるかのように読め、ADR-0001 の境界と衝突する。
2. ADR-0008 の Transport Adapter に `HTTP JSON`/`SSE`/`WebSocket` と並べて `OpenAI-compatible`/`Anthropic-compatible` を挙げているが、後者2つは transport ではなく provider protocol(request/response の形、token/cache usage の取り出し方)である。
3. Adapter Capability の値(`supported`/`best_effort`/`discovered_unverified`/`unknown`/`blocked_currently`/`unsupported`)は、「どれだけ確からしいか(confidence)」と「実際に今動くか(availability)」を1本の列挙にまとめている。ADR-0008 の Support Tier 導出ルールは「`best_effort` 以上」「`unknown` 以下」という順序関係に依存するが、この列挙には明示的な順序がない。

## Decision

### 1. 3層構造

Provider/Client Enrichment Adapter(ADR-0005)を、以下の3層に分離する。

```text
Transport                # HTTP JSON / SSE+gzip / WebSocket
Provider Protocol        # Anthropic Messages API / OpenAI Responses API
                          # token/cache usage の取り出し方、StructuralBlock 化の入り口
Client Enrichment        # Claude Code / Codex 固有の identity・thread・system-reminder 解釈
```

複数の client が同じ Transport と Provider Protocol を共有できる(例: Claude Code と Generic Anthropic Adapter はどちらも HTTP+SSE+Anthropic Messages API)。Client Enrichment だけが client 固有になる、という積み上げ方を可能にする。ADR-0008 の Support Tier ロールアップは、この3層それぞれの capability から導出する。

### 2. confidence × availability の2軸

各 capability 項目は、以下の2軸の組で宣言する。

```text
availability:                 # 実際に今動くかどうか
  available                    # 実装済みで動作する
  unimplemented                 # まだ書いていない
  blocked                      # 実装上の障害で観測不能(例: Cloudflare 403)
  unsupported                   # この client には原理的に存在しない情報

confidence:                   # availability = available の場合のみ意味を持つ。順序はこの並びの通り
  supported_contract            # provider/client が公式に契約している(例: usage レスポンスの token 数、Claude Code hook の agent_id)
  verified_best_effort           # 非公式だが現バージョンで実測検証済み(例: cc_version marker)
  discovered_unverified          # 手がかりは見つかったがライフサイクル等が未検証(例: Codex の session-id header)
  unknown                       # 何も分かっていない
```

`availability != available` の場合、confidence は評価しない(N/A)。ADR-0008 の「`verified_best_effort` 以上」のような閾値判定は、この順序付き列挙に対してのみ行う。

### 3. Core Task authority は変更しない

`ClientAdapter` インターフェースの `identifyTask(request)` を `extractClientSessionMetadata(request)` に改名し、戻り値を `external_session_id` とする。これは Core の `task_id` ではなく、Enrichment Adapter が保持する外部相関用の値に過ぎない。**Core の `task_id` を発行できるのは `wrap` のみ**(ADR-0001)であることを、インターフェースのレベルでも明確にする。将来 ADR-0007(native integration)が accepted になった場合のみ、この権威関係を再検討する。

## Considered Options

- **capability を単一軸のまま、値の種類だけ増やす**: 却下。順序関係の欠如という根本問題が解決しない。
- **`identifyTask` をそのまま残し、実装レベルの規約で「Core の task_id は上書きしない」と運用でカバーする**: 却下。ADR-0001 が明示的に境界を切った理由(意味的な誤読を防ぐ)に反する。

## Consequences

- ADR-0005/ADR-0006/ADR-0008 の capability 宣言例(`http_capture = supported` 等)は、本 ADR の2軸表記に読み替える。既存 ADR の本文は歴史的記録として残すが、実装は本 ADR の表記を正とする。
- ADR-0008 の Transport Adapter リストから `OpenAI-compatible`/`Anthropic-compatible` を除き、Provider Protocol 層に移す。
- `ClientAdapter` の `identifyTask` を参照している箇所(spec.md §8 等)は `extractClientSessionMetadata` に更新する。
