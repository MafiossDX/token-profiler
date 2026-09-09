---
status: accepted
---

# Claude Code Conversation Thread identity as a Client Enrichment Adapter, stored on `requests`

> 現在の配置: 実装は `src/enrichment/claude-code.ts`(`identifyThread(systemText: string)` — 引数は抽出済みの system テキスト文字列)。呼び出し位置は `src/recorder.ts` の `recordObservedRequest`(`insertRequest` の直前)。テストは `test/enrichment-claude-code.test.ts`。以下の本文は決定時点(`src/adapters/claude-code.mjs`、`recordRequest` から `identifyThread(requestBody.system)`、ADR-0009 の3層化前)の記録であり、決定内容そのものは不変。

ADR-0005/0009 はすでに `ClientAdapter` というレイヤ構造(Core Measurement の上に Client Enrichment を積む、`task_id` の権威は常に `wrap` 側)と、`availability × confidence` の2軸信頼度モデルを確定していた。しかし実装は存在せず、item 19(`spec/token-profiler-spec.md`)は「系列B に安定した外部識別子はあるか」を未確認のまま残していた。

`docs/adr/0012`(targeted debug row capture)で実際に `wrap --debug-capture-filter "system:first:2048" -- claude` を実行し、系列Bの system block 先頭の可変域(item 19 で見つかっていた 1,067 byte)を直接確認したところ、非公開の擬似ヘッダ

```
x-anthropic-billing-header: cc_version=X.Y.Z.<suffix>; cc_entrypoint=sdk-cli; [cc_is_subagent=true;]
```

がテキストとして system prompt の先頭に埋め込まれていることが分かった。同一 Task 内で `<suffix>` を比較すると、メインエージェントの6リクエストはすべて同じ値(`708`)、サブエージェントの1リクエストは別の同じ値(`b8b`)を持っていた — つまり `<suffix>` はリクエスト毎のランダム値ではなく、Agent 単位で安定する識別子だと考えられる(1 Task のみで確認、複数 Task/バージョンをまたいだ再現性は未検証)。この事実は item 19 の問いに Yes で答えるが、ADR-0005/0009 の語彙に従えば `supported_contract`(公式契約として保証)ではなく `verified_best_effort`(実測で確認したが非公開仕様に依存)に留めるべきものである。

## Decision

`src/adapters/claude-code.mjs` を新設し、`identifyThread(systemField)` を実装する。正規表現でヘッダを system テキストの**先頭**からのみマッチさせ(先頭以外に出現しても意図的に無視 — 埋め込みテキストが偶然一致する事故を避けるため)、`{externalSessionId, ccVersion, entrypoint, isSubagent}` を返すか、マッチしなければ `null` を返す(例外を投げない — 呼び出し側は常にオプショナル値として扱う)。

- **格納先は新テーブルではなく `requests` の2カラム**(`thread_external_id TEXT`, `is_subagent INTEGER`)。理由は Considered Options を参照。
- **信頼度宣言**: `capabilities.thread_identity = {availability: 'available', confidence: 'verified_best_effort'}`、`capabilities.subagent_identity = {availability: 'available', confidence: 'discovered_unverified'}`(`cc_is_subagent` フィールドは ADR-0005 の過去スパイクで観測されていたが、今回のサブエージェント capture には出現しなかった — 原因未確認のため、`thread_identity` 本体より一段低い confidence に据え置く)。
- **呼び出し位置**: `src/proxy/server.mjs` の `recordRequest` が `insertRequest` の直前に `identifyThread(requestBody.system)` を呼び、結果を `threadExternalId`/`isSubagent` として渡す。Core Measurement(fingerprint/chunk/usage 抽出)より後、かつそれらに一切影響しない場所に置くことで、ADR-0005 の「Core の `task_id` 権威は Adapter に一切依存しない」という制約をコード上でも保つ。
- **失敗時の扱い**: マーカーが見つからない場合は静かに `NULL` を格納する(例外にしない、リクエストの記録自体は止めない)。`computeThreadBreakdown`(`src/core/metrics.mjs`)は `thread_external_id IS NULL` のグループを "unknown" として表示し、これも1つの正当なグループとして扱う。
- **表示**: `report.mjs` は thread が複数(`threadBreakdown.length > 1`)のときだけ "Conversation Thread breakdown" セクションを追加表示し、単一スレッドの Task ではノイズを増やさない。

## Decision Evidence

内部 dogfooding スパイク(`wrap` 実行下)。`debug-capture`(ADR-0012)で 1 セッションから捕捉した system prompt 先頭 chunk の 2 ファイル分の実内容が根拠 — メインエージェントの全 request が同一 `<suffix>`、サブエージェントは別の同一 `<suffix>` を持っていた(capture 後に purge 済み)。

## Considered Options

- **専用テーブル `conversation_threads`(thread_external_id を主キーとした正規化)**: 却下(v0時点)。現状 thread のメタデータは `external_id`/`is_subagent` の2値のみで、`requests` に非正規化しても JOIN コストも複雑さも増えない。将来 thread 単位の追加属性(名前、開始時刻など)が要るようになったら再検討する。
- **Adapter の結果をリクエスト記録後に別テーブルへ非同期で書く**: 却下。`requests` 1行に対して thread 識別は常に1対1(同一リクエストが複数 thread に属することはない)ため、JOIN を挟む理由がない。
- **`cc_is_subagent` 欠如を `false` にフォールバックする**: 却下。「明示的に false と分かった」ことと「フィールド自体が今回出現しなかった」ことは異なる確信度の情報であり、混同すると `discovered_unverified` の意味が壊れる。`null`(不明)のまま残す。
- **`confidence: supported_contract` として扱う**: 却下。ヘッダはドキュメント化されていない内部実装詳細であり、Anthropic 側の互換性保証は一切ない。ADR-0005/0009 の語彙上、実測のみに基づく識別は `verified_best_effort` が上限。

## Consequences

- `thread_external_id`/`is_subagent` は非公開ヘッダのフォーマットに依存するため、Claude Code のバージョンアップで壊れる可能性がある(`identifyThread` は正規表現不一致時に静かに `null` を返すだけなので、壊れても Core Measurement には影響しない — 縮退は "unknown" グループが増えるだけ)。
- `<suffix>` の Agent 単位安定性は1 Task のみで確認された事実であり、複数 Task/複数バージョンでの再現性確認は今後の課題として残る(それまでは `verified_best_effort` からの追加昇格はしない)。
- サブエージェント起動と `<suffix>` の対応は 1:1 と仮定しない。別 Task の観測で、`is_subagent = 1` の複数 request が**同一 suffix を複数のサブエージェント起動をまたいで**共有しているように見えるケースがあった(ADR-0005 初回スパイクの「1起動 = 1 suffix」とは一致しない)。よって `verified_best_effort` の `thread_external_id` は「client 由来の会話系列キー(粒度は client 依存・非公開仕様依存)」までに留め、UI・docs で「1 thread = 1 サブエージェント起動」を含意する表現はしない(UI ラベルは `thread` / `main` / `subagent` まで)。サブエージェント起動を分離できる別マーカーがあるかは未調査。
- `cc_is_subagent` 欠如の原因(呼び出し経路依存か、バージョン依存か、単なるサンプル数1の偶然か)は未解明のまま。判明したら `discovered_unverified` の見直しを検討する。
