---
status: accepted
---

# Targeted debug row capture as a scoped, opt-in exception surface — not a privacy-first exception

ADR-0002 は raw payload をデフォルトで保存しない(fingerprint/chunk/byte_length のみ)ことを privacy-first の中核原則としている。一方で内部 dogfooding スパイクの実測で、サブエージェント由来の system prompt は 99.1%(111 chunk 中 110)のバイトが独立2セッションをまたいで完全一致するが、先頭 1,067 byte(0.89%)だけが毎回変動することが分かった。この変動域が何を含むか(Q10 の `cc_version` suffix 相当の機構かどうか)は、fingerprint/byte_length というメタデータだけでは判定できず、かつ既存の測定パイプラインは raw text を fingerprint 生成後に破棄するため、原理的に事後確認ができない。

このような「特定の未解決設計判断を検証するために、狭い範囲の raw content を一度だけ見る必要がある」というケースは、システム動作を静かに理解するための知見であり、恒久的な運用データとして保持すべきものではない。ADR-0002 の適用範囲(デフォルト測定パイプラインが何を永続化するか)自体は変えず、それとは別の、明示的 opt-in の診断専用経路を用意する。

## Decision

`wrap --debug-capture-filter "<blockType>:<chunkSelector>:<maxBytes>"` を追加する(`src/debug-capture.mjs`)。

- **デフォルト無変更**: フラグを渡さない限り `debugCapture` は `undefined` のまま ingest パイプライン(現行は `recordObservedRequest` → `ingestExtractedBlocks`、決定時点は `ingestRequestBody`)まで素通りし、一切のファイルが作られない。
- **範囲限定**: request 全体でも StructuralBlock 全体でもなく、既存の CDC ContentChunk 単位(`blockType`・`chunkSelector` で絞り込み)でのみ書き出す。
- **上限必須**: `maxBytes` を省略できない構文にした。
- **保存先**: `~/.token-profiler/debug-capture/<task_id>/`(既存の `secret.json`・profiler DB と同じ場所、git 管理対象の外)。chunk 本文(`.txt`)と `task_id`/`request_index`/`block_seq`/`chunk_seq`/`byte_length`/`captured_bytes`/`truncated`/`created_at` を持つメタデータ(`.json`)を対で書く。
- **通常経路から隔離**: profiler の SQLite DB には一切書かないため、`report`/将来の UI からは構造的に到達不能。
- **管理コマンド**: `debug-capture list` / `debug-capture purge (--task <id> | --all) [--older-than-days N]` を用意し、確認と削除を明示操作にする(`--task`/`--all` のどちらも無い `purge` は拒否し、事故的な全削除を避ける)。

## Decision Evidence

内部 dogfooding スパイクの実測。独立2セッション比較で、サブエージェント由来の system block の CDC chunk 111個中110個(99.1% のバイト)が exact fingerprint 完全一致した一方、先頭 chunk のみ不一致だったことが、この診断ツールの直接の動機。

## Considered Options

- **実行中セッションへの後付け enable**(`debug-capture enable --task <id> ...`): 却下(今回は見送り、non-goal)。プロキシプロセスへの IPC/制御ソケットが必要になり、今回の実際の用途(次回 `wrap` セッションで特定 chunk を覗く)には過剰。need が具体化したら別途検討する。
- **request body 全体を保存するデバッグモード**: 却下。ADR-0002 が避けた「raw payload の保持」問題をそのまま再導入してしまい、「block/chunk 単位に限定する」という要件と矛盾する。
- **ADR-0002 のデフォルトそのものを緩める**(retention 期間付きで raw payload を常時保存): 却下。今回の need は「特定の未解決設計判断の検証」という一時的・限定的なものであり、恒久的な仕様変更にする理由がない。

## Consequences

- `report`/UI が誤って capture ディレクトリを読みに行かないよう、今後もこの経路は DB を経由しない設計を維持する必要がある(意図的な結合の欠如)。
- capture ファイルは平文でローカルディスクに残るため、`purge` の実行は利用者側の責任(TTL 自動削除の daemon 化はしていない — v0 は手動 purge のみ)。
- `--debug-capture-filter` の構文(`blockType:chunkSelector:maxBytes`)は spike/診断用途を優先した最小実装であり、将来 UI 化するなら別途検討が要る。
