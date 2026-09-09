---
status: accepted
---

# Agent/Task identity is explicit via `wrap`, never inferred

Proxy だけでは、どの HTTP request がどの Agent(Orchestrator/Reviewer/Worker)由来かを判定できない。OpenTelemetry SDK 統合をすべての対象 CLI に要求するのは統合コストが高く、`wrap` の「API Base URL を切り替えるだけ」という手軽さ(§5.1)と矛盾する。

そこで、`token-profiler wrap -- <cmd>` で明示的にラップされたプロセスのみを Agent として識別する方式を採用した。`wrap` は Task ID(初回は自動発行の UUIDv7)を環境変数で子プロセスに継承させ、Proxy には env var が見えないため `Proxy Binding`(opaque token を埋め込んだ API Base URL)で HTTP request を (task_id, agent_id, agent_role) に紐づける。

子プロセスが暗黙に環境変数を継承しただけでは同一 Agent 内のトラフィックとして扱われ、別 Agent として区別されるには改めて明示的に `wrap` される必要がある。OS レベルのプロセス系譜自動検出(PID/PPID 追跡)は行わない。Agent Role も同様に、Agent 名や tool 利用パターン・発話内容からの推測は行わず、明示的な semantic attribute(`wrap` 引数または agent id→role の設定マッピング)としてのみ与えられ、未指定時は `unknown` として扱う。

識別子階層は `Task → Agent → Request` を canonical hierarchy とし(のちに ADR-0005 で `Conversation Thread` を Enrichment 層の一部として追加)、`trace_id`/`span_id` のような OTel 由来の識別子は必須ではなく、対象プロセスが独自に OTel を発行している場合にのみ記録するオプションの相関フィールドに格下げした。

## Considered Options

- **OS プロセス系譜の自動検出**: 実装が Windows/Unix で異なり複雑になる上、Agent Role のような意味的ラベルは結局取得できず、匿名 ID にしかならないため却下。
- **Claude Code の Task tool のような単一プロセス内 subagent の識別**: プロセス境界を越えないため `wrap` の仕組みでは原理的に捕捉できない。MVP では非対応とし、将来課題とした。→ 実測の結果、Claude Code に限っては client 固有の marker で部分的に識別可能なことが判明した。ただし Core の Agent identity モデル(本ADR)は変更せず、`Conversation Thread` という別概念を Enrichment Adapter 層に追加する形で対応する(ADR-0005)。

## Consequences

- ユーザー(またはオーケストレーションスクリプト)が子 Agent 起動時に `wrap` を挟むことを意識する必要がある。素の CLI を直接起動された場合、そのトラフィックは親 Agent に帰属する。
- Agent Role を明示しない場合、Review Cycle 検出などロールに依存する診断機能は動作しない(`unknown` のまま判定を保留する)。
