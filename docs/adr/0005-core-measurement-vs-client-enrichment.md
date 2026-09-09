---
status: accepted
---

# Core Measurement is protocol-independent; client-specific knowledge lives in Enrichment Adapters

> **Amended by ADR-0009**: `identifyTask(request)` は `extractClientSessionMetadata(request)`(戻り値 `external_session_id`)に改名した。Core の `task_id` を発行できるのは `wrap` のみで、Adapter はこれを上書きしない。capability の宣言値(`supported`/`best_effort`/...)は confidence × availability の2軸表記に置き換えた。以下の本文は歴史的記録として残す。

Q10(spec.md §25)の実測スパイクで、Claude Code は system prompt の先頭に非公開の擬似ヘッダ(`x-anthropic-billing-header: cc_version=X.Y.Z.<suffix>; cc_entrypoint=sdk-cli; cc_is_subagent=true;`)を埋め込んでおり、`cc_version` の suffix が同一プロセス内の独立した会話系列(orchestrator 本体 / Task tool subagent / 小さな1shotユーティリティ呼び出し)を安定して区別できることを確認した。これは ADR-0001 が「プロセス単位でしか Agent を識別できない」としていた制約を、少なくとも Claude Code に関しては部分的に解消できることを意味する。

しかしこの marker は Anthropic/Claude Code の非公開・バージョン依存の内部実装詳細であり、公開 API 契約ではない。これを Core の Agent identity モデル(ADR-0001: `wrap` によるプロセス単位の明示的識別)に直接組み込むと、Claude Code の内部実装が変わった瞬間に Task / Agent / Context Amplification のような中核指標まで壊れるリスクを抱え込むことになる。

そこで、測定基盤を明確に二層に分離する。

```text
Core Measurement(protocol-independent、全 provider/client 共通)
────────────────────────────────────────────
Task / Agent / Request
StructuralBlock / ContentChunk / Fingerprint
Context Amplification / Exact Reuse Ratio

Provider / Client Enrichment Adapter(client 固有、best-effort)
────────────────────────────────────────────
Claude Code: Conversation Thread(cc_version suffix 由来)
Claude Code: subagent marker(cc_is_subagent)
Claude Code: cache semantics の解釈
将来: Codex thread metadata、他 CLI の metadata 等
```

Conversation Thread(`Task → Agent → Conversation Thread → Request` という階層で、Agent 内部の独立した会話系列を表す新概念)は、この Enrichment Adapter 層の最初の実例として追加する。Agent の定義(ADR-0001: `wrap` によるプロセス単位の識別)自体は変更しない。`cc_version` suffix のような client 固有の値を native な `agent_id` に昇格させることはしない。

Thread の Role 付与も、Agent Role と同じ原則(意味を推測しない)に従う: subagent は自分の型を機械可読な形で自己申告しないため、system prompt の Exact Fingerprint(既存の Core 基盤)に対して、ユーザーが明示的に role をマッピングする(`thread_roles: { system_fingerprint: ..., role: ... }`)。marker から確実に分かるのは「これは独立した thread である」「これは subagent である」までであり、「この thread が reviewer である」ことまでは marker からは分からない。

## Adapter interface と capability declaration(Codex スパイクで具体化)

Codex に対して同種のスパイクを行ったところ、Claude Code とは性質の異なる enrichment 手がかりが見つかった: Codex は `session-id` / `thread-id` を **素の HTTP ヘッダー**として送っている(Claude Code のように system prompt に埋め込まれた非公開 marker ではない)。一方で Codex の Responses API は **WebSocket が第一選択**であり、かつ ChatGPT OAuth backend(`chatgpt.com`)は Cloudflare 保護されていて、今回の簡易 HTTP 終端 proxy では 403 で弾かれ、実際の payload 構造も cache/subagent 相当の marker 有無も確認できなかった。

これにより、Enrichment Adapter は「対応 / 非対応」の二値ではなく、**client ごとに異なる capability を宣言する**設計であるべきだと判明した。ClientAdapter の責務を以下に限定する:

```text
ClientAdapter
  identifyTask(request)
  identifyThread(request)
  identifySubagent(request)
  classifyProtocolContext(payload)
  extractCacheUsage(response)
```

そして各 Adapter は、上記の各機能について confidence を宣言する(例: `supported` / `best_effort` / `discovered_unverified` / `unknown` / `blocked_currently`)。実測時点の例:

```text
ClaudeCodeAdapter
  http_capture       = supported
  sse_capture        = supported
  websocket_capture  = unsupported
  thread_identity    = best_effort      # verified for current version
  subagent_identity  = best_effort      # verified for current version
  cache_usage        = supported

CodexAdapter
  http_capture       = blocked_currently   # Cloudflare 403(TLS fingerprint 起因と推測、未確定)
  websocket_capture  = unsupported          # proxy 未対応
  thread_identity    = discovered_unverified # session-id/thread-id header は観測したが lifecycle 未検証
  subagent_identity  = unknown
  cache_usage        = unknown
```

Proxy 自体の transport capability(HTTP JSON / SSE+gzip / WebSocket)も同様に Core 側の宣言事項として扱う。WebSocket 対応・Cloudflare 回避(TLS を素通しする低レイヤー proxy 等)は、Core の仕様を歪めてまで今解く必要はない **実装時の integration engineering 課題**として凍結し、§25 の未解決事項に留める。

## Consequences

- Claude Code の内部実装(marker の形式やバージョン文字列)が変わっても、Core Measurement(Context Amplification、Exact Reuse Ratio、Token Traffic 等)は影響を受けない。壊れるのは Claude Code Enrichment Adapter に依存する機能(Thread 単位の Flamegraph、subagent 単位の Review Cycle 等)のみで、影響範囲が明示的に切り分けられる。
- Enrichment Adapter は marker が消えた・形式が変わった場合に静かに `unknown`/`no thread info` にフォールバックする必要がある(§25 spec.md「Claude Code adapter degradation」)。
- Codex の Conversation Thread 対応は `discovered_unverified` に留まる: `session-id`/`thread-id` header の存在は確認したが、それらが Task ごとか・login session ごとか・subagent とどう対応するかのライフサイクル検証がまだできていない。
- Codex や他の CLI に同種の手がかりがなければ、それらのツールでは Conversation Thread 粒度の機能は提供されず、Agent 粒度(ADR-0001)止まりになる。これは劣化ではなく、Core Measurement が protocol-independent であることの正しい帰結である。
- もし机上の設計だけで進めていたら、「Base URL を localhost に向ければ全 client で同じように observability が取れる」という generic proxy 設計に寄せていたリスクが高い。実測の結果、Claude Code(payload 内 marker、HTTP/SSE)と Codex(header 候補、WebSocket-first、Cloudflare 保護された OAuth backend)は実装上まったく性質が異なることが分かった。これが Core/Adapter 分離(本ADR)の妥当性を裏付ける最大の根拠になった。
