---
status: proposed
---

# Persistent native integration (settings.json + daemon) vs wrap-first: deferred

RTK(https://github.com/rtk-ai/rtk)との比較検討から、`token-profiler wrap -- <cmd>` を毎回打つ代わりに、`init` コマンドで `~/.claude/settings.json` に `env.ANTHROPIC_BASE_URL` と hook 設定を一度だけ書き込み、以後は素の `claude` 起動だけで観測が始まる UX が提案された。ADR-0006 で Claude Code の公式 hook から `SessionStart`/`SessionEnd`/`SubagentStart`/`SubagentStop` が取得できることも確認済みで、これを Task/Agent 境界の identity source として使う native-first アーキテクチャへの移行が技術的には可能に見える。

しかしこれは単なる起動 UX の変更ではなく、ADR-0001 が意図的に選んだ設計境界を変更する提案である: 現在の `wrap` は「このセッションを観測する」という明示的な per-invocation の consent boundary であり、Task の開始/終了も「wrap された root process の生存期間」として厳密に定義されている(CONTEXT.md Design boundary)。`settings.json` への常設変更は、その machine 上のすべての `claude` 起動をデフォルトで観測対象にする(opt-in per-invocation → opt-out global)。

## Status

**Proposed. 採用するかどうかは未決定。** ADR-0006(hook による identity_metadata 取得)とは独立した decision であり、ADR-0006 の採用は本 ADR の採用を前提としない。

## Decision drivers(採用可否を判断する条件)

1. **並行 subagent の request attribution 実測**(ADR-0006 で残した未解決事項)。native-first は多くの request を単一の proxy endpoint で受けることになるため、この相関が取れない限り Task/Agent への帰属精度が `wrap` 方式より劣化する可能性がある。
2. **daemon 障害時の semantics。** RTK の PreToolUse hook は失敗時に元の command へ fail-open できるが、`ANTHROPIC_BASE_URL` を localhost に固定する API proxy は同じ形で fail-open できない(daemon が落ちていると Claude Code そのものが通信不能になる)。login 時常駐 service 化などの運用要件が新たに発生する。
3. **opt-in / pause / uninstall UX と default-on の blast radius。** `wrap` は「意識して挟む」ことで観測対象を明示的に選べるが、`settings.json` 常設化は「意識せず全セッションが観測される」方向への転換であり、意図しない private/work プロジェクトの観測を防ぐ pause/exclude の仕組みが要件に加わる。
4. **Privacy boundary。** ADR-0002 は Similarity Signature を「無害なメタデータ」ではなく sensitive metadata として扱うと明記している。全セッション自動 capture になると、この sensitive metadata がユーザーの明示的な意図なしに生成され続けることになり、同意設計を再検討する必要がある。
5. **Task identity source の委譲。** 現在 Task 境界は「`wrap` された root process の生存期間」という Core Measurement 側の定義(ADR-0001)。native-first に移行すると、Task の開始/終了を `SessionStart`/`SessionEnd` という Claude Code 固有の hook イベントに委譲することになり、これは UX の変更ではなく **Core Task identity source の変更**である。ADR-0005 が明確に分離した Core/Adapter 境界を越える可能性があるため、単独では決定しない。

## Consequences(現時点)

- 上記条件が満たされるまで、`wrap` が唯一の Task/Agent identity source であり続ける(ADR-0001 は変更しない)。
- RTK の install-once UX(`init` / `status` / `uninstall` のコマンド設計)は、CLI ergonomics の参考としてのみ採用する。identity/consent の仕組みまで RTK に合わせることは、本 ADR が accepted になるまで行わない。
- 本 ADR が accepted になった場合、CONTEXT.md の Design boundary(§`wrap` は明示的にラップされたプロセスのみを Agent として識別する)と spec.md §26(`localhost daemon + wrap + proxy + Web UI + MCP` という基本形)の両方を改訂する必要がある。
