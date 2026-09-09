---
status: accepted
---

# Claude Code hook identity is a separate capability axis from request attribution

> **Amended by ADR-0009**: capability の宣言値は confidence(`supported_contract`/`verified_best_effort`/`discovered_unverified`/`unknown`)× availability(`available`/`unimplemented`/`blocked`/`unsupported`)の2軸表記に置き換えた。本 ADR の `identity_metadata = supported` は `identity_metadata: availability=available, confidence=supported_contract` と読み替える。以下の本文は歴史的記録として残す。

Claude Code は `SessionStart` / `SessionEnd` / `SubagentStart` / `SubagentStop` という公式 hook を提供しており、`SubagentStart`/`SubagentStop` には `session_id` / `agent_id` / `agent_type` が渡される。これは ADR-0005 で確認した `cc_version` suffix marker(system prompt に埋め込まれた非公開の擬似ヘッダ)とは異なり、公開契約された first-party metadata である。

しかし hook はプロセスの lifecycle event を伝える side channel であり、個々の HTTP request に直接タグ付けされるわけではない。Claude Code の subagent(Task tool)が並行に複数走るケース(overlapping `SubagentStart`/`SubagentStop`)では、start/stop のタイムスタンプだけでは「この request がどの agent 由来か」を一意に決定できない可能性がある。一方 `cc_version` suffix は request payload 自体に含まれるため request 単位の判別に使えるが、`agent_type` のような意味情報は持たない。

つまり両者は代替関係ではなく補完関係にある: **hook は「誰がいるか」(authoritative identity)、marker は「どの request か」(request-level discriminator)**。

## Decision

ADR-0005 の Adapter Capability を、`thread_identity`/`subagent_identity` という単一軸から 2 軸に分割する。

```text
identity_metadata    # hook から得る authoritative な agent_id/agent_type/session_id
request_attribution  # 個々の HTTP request を特定の agent/thread に紐づける能力
```

実測時点の Claude Code Adapter:

```text
identity_metadata    = supported       # SubagentStart/Stop hook, 現バージョンで実測検証済み
request_attribution  = best_effort     # cc_version suffix marker(ADR-0005 から変更なし)
```

`identity_metadata` と `request_attribution` を突き合わせて一意対応が取れることを、並行 subagent 実行シナリオで実測できるまでは、`request_attribution` を `supported` に上げない。並行実行下での相関検証は spec.md §25 の未解決事項として残す。

Core Agent identity model(ADR-0001: `wrap` によるプロセス単位の明示的識別)は変更しない。hook から得た `agent_id`/`agent_type` は Core Agent に昇格させず、既存の Conversation Thread(Enrichment Adapter 層、ADR-0005)に付与するメタデータとして扱う。

## Considered Options

- **hook の `agent_id` をそのまま Core Agent へ昇格させる**: 却下。プロセス境界を越えない(Claude Code 内部の subagent は別プロセスにならない)ため ADR-0001 の Agent 定義(`wrap` された process 単位)と矛盾する。ADR-0005 の「client 固有の値を native `agent_id` に昇格させない」原則にも反する。
- **`cc_version` marker を hook で完全に代替し、marker を fallback evidence に降格する**: 却下。並行 subagent 下での request-level 相関が未実証な段階でこれを行うと、hook の start/stop window が重なった瞬間に request の帰属を誤る可能性がある。

## Consequences

- Claude Code Enrichment Adapter の capability 宣言に `identity_metadata` が追加され、既存の `thread_identity`/`subagent_identity` は `request_attribution` として読み替える(spec.md §25 item 0 を更新)。
- hook が提供する `agent_type`(例: `security-reviewer`)を Thread Role(CONTEXT.md)の自動ソースとして使うかどうかは、本 ADR ではスコープ外として未決定のまま残す — Thread Role は「意味的分類を推測しない」原則のもと、現状ユーザーによる明示的な `thread_roles` マッピングを要求しており、hook の `agent_type` がその要件を代替できるかは別途検討する。
- 並行 subagent 実行下での `identity_metadata` ↔ `request_attribution` 相関 spike が今後必要。
