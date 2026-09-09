# 現状 (STATUS)

CONTEXT.md と `docs/adr/` の履歴を全部読まずに「今どこまで動くか」を把握するための 1 ページ。
詳細の正本は各リンク先。最終更新の目安: ADR-0018 時点。

## 今できること

- **`token-profiler wrap -- <cmd>`**: 対象 CLI を子プロセス起動し、Proxy 経由で API traffic を記録
  (Task / Agent / Agent Role / Proxy Binding を明示発行)。Claude の挙動・API 料金は変えない。
- **`token-profiler report <task_id>`**: Task の測定値を CLI 出力。
- **観測 UI(`/`、`token-profiler ui` または `wrap` 相乗り、既定 `127.0.0.1:7331`)**:
  Context Amplification の診断的な読み。5 パネル(Export はパネル番号を持たず Task 見出し横の
  `<details>`、ADR-0018) —
  1 Current amplification / 2 Next focus /
  3 request 調査(集中度サマリ + 折りたたみ Pareto、一覧⇄タイムラインの表示切替、ページング付き、
  隣接する Request detail)/ 4 推移・閾値プロット / 5 重複文脈バイトの内訳。
  - 参照ゾーンは倍率レンジ表記(`1–2x` / `2–5x` / `5–10x` / `10x 以上`)。評価語は出さない。
  - Next focus のカード・一覧の行・タイムラインの点のクリックで選択 request が連動し、
    Request detail に反映(表示切替をまたいで選択・ページ・ソートを保持)。
  - フィルタ 3 軸: All traffic / thread / context_class。
  - CSV / JSON Export(この Task 全体 / 現在のフィルタ、Task 見出し横の `<details>`)。
  - 確認付き Task 削除(唯一の write path)。
  - poll 失敗時はヘッダに「取得失敗・表示は最新でない可能性」マーカー。
- 正本: `docs/ui-information-design.md`、`docs/adr/0016-*.md`、`docs/adr/0017-*.md`、
  `docs/adr/0018-*.md`、spec §14。

## 未実装(将来)

- fingerprint 出現履歴、Task 比較、Task 名前・メモ(ADR-0017 Deferred。新しい write path が絡むため
  方針決定が先)
- token basis(ローカル tokenizer)— 現状 byte basis のみ
- Expert Diagnostics の warning レイヤー(spec §13。ADR-0014 / ADR-0016 で Fact と分離した将来レイヤー)
- Token Flamegraph / Flow Graph(spec §11–§12)
- 配布 CI(ADR-0015 B — タグ付き Release での tarball 配布)。現状は `npm run build` 前提

## 既知の限界

- **server-side conversation state を使う API**(Codex Responses 等)では、Context Amplification が
  測るのは request payload に載った context(request-visible)だけ。provider 側に保持され再送されない
  context は観測できない(Full Profiling を主張する client でも同じ)。
- **参照ゾーンの閾値**(2 / 5 / 10x)は heuristic。Fact ではない。将来ユーザー設定可にする余地。
- **thread ↔ StructuralBlock の対応**は v0 測定範囲外。重複文脈バイトの内訳バーは Task 全体のまま。
- **Conversation Thread** は Enrichment Adapter 由来(Claude Code: `verified_best_effort`)。
  Core Measurement ではない。
- **意味的分類・用途名は推測しない**(Agent Role / Thread Role は明示入力のみ)。
- Amplification / Exact Reuse / Token 数の **Task 間比較は Measurement Profile 互換な Task 同士に限る**。

## 正本リンク

- ドメインモデルと用語: [`CONTEXT.md`](../CONTEXT.md)
- 作業仕様: [`spec/token-profiler-spec.md`](../spec/token-profiler-spec.md)
- UI 情報設計: [`docs/ui-information-design.md`](ui-information-design.md) /
  [`docs/ui-diagnostic-concept.md`](ui-diagnostic-concept.md)
- UI 読み方ガイド(利用者向け): [`docs/ui-reading-guide.md`](ui-reading-guide.md)
- 決定記録: [`docs/adr/`](adr/) — とくに ADR-0011(context_class / Fact・Diagnostic 分離)、
  ADR-0014(観測 UI の Fact-only、部分 superseded)、ADR-0016(診断的な読みを主にする)、
  ADR-0017(根拠の近接・評価語の記述化)、ADR-0018(request 調査パネルの統合・ページング)、
  ADR-0015(UI ビルド + 配布)。
