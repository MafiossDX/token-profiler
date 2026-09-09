---
status: accepted
---

# Client support is expressed as a Support Tier derived from Adapter Capability, never assigned by hand

> **Amended by ADR-0009**: 本 ADR の Transport Adapter リストにある `OpenAI-compatible`/`Anthropic-compatible` は Transport ではなく Provider Protocol 層に属する(ADR-0009 の3層構造を参照)。Support Tier のロールアップ判定は confidence × availability の2軸表記(ADR-0009)に基づく。以下の本文は歴史的記録として残す。

RTK との比較検討で、「何種類の client に対応しているか」を KPI にすると、このツールの品質が崩れやすいことが分かった。RTK は `git status` → `rtk git status` のような transparent rewrite で価値が出るのに対し、Profiler は client ごとに request capture・transport(HTTP/SSE/WebSocket)・system-reminder 分類・cache semantics・subagent identity・request attribution まで踏み込まないと本来の価値(Context Amplification 等)が出ない。1 client を増やすコストが RTK よりはるかに高い。

このため「対応 / 非対応」の二値で client 数を数えると、ADR-0005 が明確に避けた二値評価が client 単位で復活してしまう(例: Context Amplification しか取れない client を「対応」と表示すると誤解を招く)。

## Decision

client ごとの対応度を **Support Tier** として表現する。値は `Full Profiling` / `Traffic Profiling` / `Basic・Experimental` / `Not Tested` の4段階。

**重要な制約: Support Tier は、既存の Adapter Capability 宣言(ADR-0005・ADR-0006 の `http_capture`/`sse_capture`/`websocket_capture`/`identity_metadata`/`request_attribution`/`cache_usage` 等)から機械的に導出する関数の出力であり、client ごとに手で割り当てるラベルにしてはならない。** 手で割り当てた瞬間、ADR-0005 が退けた「対応/非対応」の二値評価が粒度を変えて戻ってくる。

目安(閾値の正確な定義は実装時に確定、本 ADR ではロールアップの原則のみ確定させる):

- **Full Profiling**: capture(http/sse) = `supported` かつ Protocol/Application Context 分類が可能 かつ Context Amplification 計算可能 かつ `identity_metadata`/`request_attribution` が `best_effort` 以上 かつ `cache_usage = supported`
- **Traffic Profiling**: capture・fingerprint・Context Amplification は `supported` だが、thread/subagent/cache 系の capability が `unknown` 以下(例: base URL override だけ可能な Generic Anthropic/Generic OpenAI adapter)
- **Basic・Experimental**: Task 単位の total traffic 程度のみ、context decomposition や subagent attribution は非対応
- **Not Tested**: Adapter 未実装、または capability 未検証

## Naming との衝突に注意

CONTEXT.md には既に **Measurement tiers**(`Observed`/`Deterministic`/`Derived`/`Estimated`/`Diagnostic`、指標ごとの epistemic status を表す軸)という語がある。Support Tier は client ごとの capability ロールアップであり、Measurement tiers とは別軸(前者は「この client で何が測れるか」、後者は「ある値がどれだけ確からしいか」)。名称を混同しないこと。
_Avoid_: Tier(単独で使うと Measurement tiers と紛らわしい。必ず Support Tier と書く)

## Transport Adapter の分離

Provider/Client Enrichment Adapter(ADR-0005)の下に、**Transport Adapter** 層を明示的に分離する: `HTTP JSON` / `SSE+gzip` / `WebSocket` / `OpenAI-compatible base URL` / `Anthropic-compatible base URL`。ADR-0005 で宣言していた `http_capture`/`sse_capture`/`websocket_capture` は、この Transport Adapter 層の capability として位置づけ直す。

複数 client が同じ Transport(例: OpenAI-compatible base URL override を持つ CLI)を共有する場合、Transport Adapter を再利用し、client 固有の Enrichment Adapter(identity/thread/cache の解釈)だけを追加すればよい。これにより新 client 追加のコストが「Transport 再利用 + Enrichment 追加」に分解でき、対応数を KPI にしなくても増分コストの見積もりが可能になる。

## Roadmap(非拘束・参考情報。本 ADR の decision の一部ではない)

- Phase 1: Claude Code(Full 目標)+ Generic Anthropic Adapter(Traffic)。MVP スコープはここまで。
- Phase 2: Codex(Full 目標、WebSocket transport 実装が前提)+ Generic OpenAI Adapter(Traffic)。
- Phase 3: Gemini CLI / Cursor / OpenCode / Copilot 等 — Transport/Enrichment 分離が実証できてから着手。
- Phase 4: community adapters。

対応 client 数はロードマップの結果であって、MVP や各 Phase の受け入れ基準ではない。

## Consequences

- Web UI の support matrix(client × capability の表)は、Support Tier を手書きせず、Adapter Capability 宣言から自動生成する実装要件を持つ。
- MVP スコープ(Claude Code + Generic Anthropic、Phase 1)は変更しない。「対応 client 数」を正式な KPI としない。
- 新しい client を検討する際は、まず Transport Adapter が既存のもので流用できるかを確認し、流用できない場合のみ Transport Adapter 自体の追加コストを見積もる。
