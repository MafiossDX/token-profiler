---
status: superseded by 0016 (partial)
---

# UI presents observations, not interpretations

> **ADR-0016 が本 ADR の Fact-only decision を上書きした。** `/` の観測 UI は Context
> Amplification の診断的な読み(参照ゾーン / Next focus / 削減候補ランキング)を主にする。
> 本 ADR のうち存続するのは: ローカルデータ管理操作の例外(確認付き Task 削除が唯一の
> write path)、意味的分類・用途名を推測しない原則、合成スコアを作らない原則、3 ペイン構成。
> 詳細は `docs/adr/0016-ui-leads-with-diagnostic-reading.md`。

1. CONTEXT.md の Measurement tiers(ADR-0011)は `Fact`(Observed / Deterministic / Derived / Estimated)と `Diagnostic`(heuristic による解釈)を明確に分離しており、「意味的分類を推測しない」原則も併せて確定している。しかし v0 の read-only localhost UI(`docs/ui-information-design.md`)は、この分離を越えて数値からの解釈をビューに載せていた:
   - Traffic Breakdown の fact 文「Protocol Context が total transport の 86.0% を占め、構造的に支配的」
   - Hotspots ビュー全体(`Protocol Context が支配的` / `Context Amplification 高` / `Subagent cold cache start` / `background/helper candidate`)
   - Reuse Timeline の派生 note「単調に近い増加で 85%+ に収束 → context replay 型の形」
   - Conversation Threads の「first request の cache_read=0 / cache_creation>0 → cold cache start」
2. これらは「支配的」「hotspot」「cold cache」「replay 型」という **名前を付けた時点で観測ではなく判断**になっている。`cache_read=0 / cache_creation>0` は Deterministic な事実だが、それに `cold cache start` と名付けて列挙するのは Diagnostic 層の仕事であり、read-only の観測 UI が担う範囲ではない。
3. dogfooding で UI 出力を読むたびに、利用者はこの editorializing を頭の中で剥がしてから生値を読む必要があった。プロダクトの役割(観測して測定値を提示する。判断は利用者が行う)とも綱引きになっていた。
4. spec.md §13 Expert Diagnostics(Wireshark の Expert Information 相当、「事実値 + heuristic」)は将来機能として spec 化されているが、対応する診断エンジンは未実装で、Hotspots はその「最小版」を先取りする形で観測 UI に紛れ込んでいた。

## Decision

read-only の観測 UI(`token-profiler ui` / `wrap` 相乗り UI)、`report`、および既定の出力は、**Fact レイヤーの値と「測定条件の注記」だけ**を提示する。Diagnostic レイヤーの内容(解釈・原因の断定・見どころ抽出・合成スコア・用途名の推定)は出さない。数値の解釈と原因特定は利用者が行う。

### 出してよいもの

- Fact レイヤーの測定値: UCV / CTV / Context Amplification / Exact Reuse Ratio / Classification Coverage / byte 内訳 / Observed token 数 / per-request の生行 / thread breakdown。断定してよい。
- **測定条件の注記**(解釈ではなく、数値を誤読させないための前提):
  - `byte basis`
  - `Application Context only`(Context Amplification の対象範囲)
  - `Classification Coverage < 95%` の警告
  - `Claude Code adapter · verified_best_effort · not Core Measurement`(ADR-0013)
  - `thread 別の再集計は v0 の測定範囲外`
- 調査操作: filter / sort / copy / export。

### 出さないもの

- 「支配的」「dominant」「overhead」「無駄」等の形容。
- Hotspots / Expert Diagnostics 相当の列挙(`cold cache start`、`background/helper candidate`、`context replay 型` 等)。
- 複数点から形を言い当てる派生 fact 文(「単調増加して収束」等)。
- confidence タグ付きであっても、profiler が検証できない用途名・分類(`candidate: background/helper` 等)。
- 合成スコア。

### v0 での適用

- Hotspots ビューを撤去。
- Traffic Breakdown は bytes・比率・Protocol Share の数値のみ。
- Reuse Timeline は折れ線 + thread 色分けのみ。
- Conversation Threads は「cold cache start」注記を廃止し、first request の `cache_read` / `cache_creation` を列の生値として見せる。
- 代替導線として **Requests テーブル**(request 単位の生行、ソート可、判断名なし)と **Export**(生データを外部ツールへ持ち出す)を追加。
- Core Measurement の計算式は一切変更しない。Context Amplification 等は引き続き計算・表示する(Deterministic Fact であり解釈ではない)。
- **セクションごとの自己解説 prose を撤去(ui-review §3)。** 各ビューの subtitle / note で
  「なぜこの数字を出すか」「プロファイラの役割は…」を毎回書いていたのをやめ、残すのは
  セクション見出し・列ラベル・空状態(`No requests` 等)・短いバッジ(`byte basis` /
  `local data`)・ボタン/リンクラベル・破壊的操作の警告・**数値を誤読させないための
  測定条件の注記のみ**。測定条件は例えば: `Claude Code adapter · verified_best_effort ·
  not Core Measurement`(Conversation Threads 見出し脇、常時)、フィルタ選択時の
  「UCV/CTV/Amplification は task 全体 / application 固定」。
- **3 ペイン化(ui-review §2)。** Requests を右ペイン(desktop で sticky・独立スクロール、
  narrow で中央ビューの下)へ。中央は Overview / Breakdown / Threads / Timeline / Export。
  Requests の行クリックは将来の selected-request detail 用に予約し、thread 絞り込みは
  `thread` セル(リンク様ボタン)クリックに移す。

### ローカルデータ管理操作の例外(ui-review §4)

観測 UI を「read-only」と呼んでいたのは *数値の解釈を UI に載せない* ためであり、
ローカルに溜めた観測データそのもののライフサイクル管理まで禁じる趣旨ではない。
**明示的な確認で gate された Task 削除は、解釈ではなくローカルデータ管理として許可する。**

- UI: Task 一覧に per-task 削除ボタン。行選択には伝播させない(`stopPropagation`)。
  `ended_at IS NULL`(実行中 = `wrap` が書き込み中の可能性がある Task)は無効化。
  削除前に full task id と request 数を出して確認する。
- API: `POST /api/tasks/:id/delete`。body `{ "confirmTaskId": "<task_id>" }` が URL の
  task id と完全一致しなければ 400。実行中 Task は 409。所有行(`content_chunks` →
  `structural_blocks` → `requests` → `agents` → `tasks`)を child-first の 1 トランザクションで削除。
- サーバは通常 read-only ハンドルで開き、削除時だけ短命の read-write ハンドルを開く
  (`openDbReadWrite` — schema/migrate は再実行しない)。DB path を知らない構成
  (`createUiServer(db)` を path 無しで呼んだ場合)では削除ルートは 403。
- 削除実装後は `read-only` バッジを外す(誤解を招くため)。`local data` バッジに置換。

これは Fact/Diagnostic 境界とは独立した話であり、上の「出さないもの」を一切緩めない。

### Diagnosis レイヤーの位置づけ

Diagnosis(likely avoidable traffic、Review Churn Suspected、Expert Diagnostics 等)は放棄しない。**Fact と明確に分離された opt-in の別レイヤー**としてのみ扱い、観測 UI や既定出力には出さない。将来の実装先候補は spec.md §13、および §19.3 の MCP 経由 Agent 自己診断。

## Considered Options

- **Hotspots を confidence タグ付きで残す**: 却下。`candidate (low confidence)` と付けても「background/helper」という用途名は profiler が検証できない推定であり、`cold cache start` や「構造的に支配的」は事実の上に載せた判断。タグは Fact/Diagnostic の境界を曖昧にするだけで、境界自体は消えない。
- **Diagnosis を UI 内のトグルの裏に置く**: 却下(v0)。診断エンジンは未 spec/未実装(spec.md §13、§19.3 の Review Churn 系はいずれも proposed)。中途半端なトグルは同じ混同を招く。Diagnosis レイヤーが実体として作られた時点で、それを別レイヤー・別 UI として載せる ADR を改めて起こす。
- **現状維持(何もしない)**: 却下。observation と interpretation の混在は dogfood 利用者に恒常的な負荷をかけ、プロダクト定義(観測ツール)を曖昧にする。
- **CONTEXT.md / README だけ直して ADR は起こさない**: 却下。文書だけだと「方針変更」に見え、将来 Hotspots 系を戻すときの判断基準が残らない。決定として記録し、再導入には superseding ADR を要求する。

## Consequences

- `CONTEXT.md` の冒頭(「診断に特化する」)と `package.json` の description を、この決定に合わせて書き換える(観測・測定値の提示に徹する / 解釈は利用者)。
- spec.md §13 Expert Diagnostics は「観測 UI には出さない別レイヤー」として本 ADR が上書きする(§13 自体の廃止ではない)。
- Hotspots 相当の機能を将来再導入するには、本 ADR を supersede する ADR が必要。これは意図的な摩擦であり、drift ではなく決定として扱うため。
- 観測 UI が「調査の入口」になったため(Requests テーブル + Export)、再描画をまたいで残すべき ephemeral UI 状態(ソート順、将来の選択行・詳細ペイン)は module-level state で保持する設計にする — polling による signature-gated 再描画で潰さないため。
- `docs/ui-review.md`(レビュー原文)と `docs/ui-information-design.md` §0/§1 が、この原則を運用ルールとして具体化する。
