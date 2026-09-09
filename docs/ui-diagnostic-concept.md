# UI Diagnostic Concept

`/` の観測 UI が採る**診断的な読み**の情報設計メモ + 用語決定ログ。実装仕様は `docs/ui-information-design.md`。

- **ADR-0016 でこれが `/` の情報設計そのものになった**。当初は「出荷 UI とは別トラックの探索」だったが、dogfooding の結果
  C5 レイアウトを `/` の主画面に採用した。spec は `docs/adr/0016-ui-leads-with-diagnostic-reading.md` +
  `docs/ui-information-design.md`。ADR-0014 の Fact-only decision は 0016 が上書き済み（partial）。
- 設計の出自: `abtest-c5.html` = `abtest-c35.html`（完成形の土台）+ 「必要なときだけ C3 由来の thread lanes を開ける」トグル。
  系譜は `abtest-a / -b / -c1..-c4`。`abtest-*.html` は静的モック（in-page サンプル + 任意で `GET /api/tasks/:id`）、非版管理の使い捨て。
- **ADR-0017 が 0016 を部分改訂**: `.two-col`（タイムライン + Request detail）をランキング直後・request 表の前へ移動、
  Next focus のカードをクリック可能に、参照ゾーンの評価語を倍率レンジ表記に置換、パネル「削減候補」→「重複の多い request」、
  RequestDetail の反実仮想文言を撤回。用語決定ログ（下記）の該当行に反映済み。
- **ADR-0018 が 0016/0017 をさらに改訂**: 「重複の多い request」ランキング・タイムライン・request 表の
  3 枚を「request 調査」1 枚へ統合し、一覧にページングを足した。表示切替（一覧⇄タイムライン）は選択・
  ページ・ソートを保持する。Export はパネル番号を外し Task 見出し横の `<details>` へ移動。下記の
  Screen Structure / Reading Order / Interactions は ADR-0018 後の姿に更新済み。
- 関連: **ADR-0016（UI leads with a diagnostic reading）**, **ADR-0017（根拠の近接・評価語の記述化）**,
  **ADR-0018（request 調査パネルの統合・ページング）**,
  ADR-0014（partial superseded — 存続部分は下記）,
  spec §13（Expert Diagnostics — warning 群は引き続き将来）, §4.2（Fact / Diagnosis 分離）, ADR-0011（context_class / Measurement tiers）,
  `docs/ui-information-design.md`（実装仕様）。

---

## Position

- **役割**: 「同一 Task 内で Context Amplification がどこから・何によって悪化したか、次にどの request を見るか」を、
  ランキングとゾーン判定で**能動的に指し示す** `/` の主画面。Wireshark の Expert Information に相当する診断視点（spec §13）を、
  UI 標準の導線として先取りしたもの。
- **本線との関係**: これが本線。`/`（`token-profiler ui` / `wrap` 相乗り UI）の中央ペインがこのレイアウト（ADR-0016）。
  ADR-0014 の Fact-only は 0016 が上書き済み。生 Fact は消えず、hero・内訳パネル・request 表・Export に残る。
- **状態**: 方向性は確定（下記「採用判断」）。実装は `src/ui/client/` で進行中。

### 採用判断（確定）

| 項目 | 決定 |
|---|---|
| デフォルトのタイムライン表示 | minimap |
| 詳細探索時 | thread lanes（opt-in トグル） |
| 主指標 | 重複文脈バイト（duplicate context bytes） |
| 画面の芯 | Current amplification → Next focus → request 調査（旧「削減候補」→「重複の多い request」、ADR-0018 で一覧・タイムライン・request 表を統合） |
| 避ける語 | 「寄与」「再送バイト」「Critical / Warning 等の評価語」「除くと〜減る」（ADR-0017） |

---

## Relationship To Observation UI

ADR-0016 より前は「観測 UI（Fact-only）とは別トラック」と位置づけていた。0016 でこれが `/` の情報設計そのものになった。

| | ADR-0014（〜0016 前） | 現在（ADR-0016） |
|---|---|---|
| 統治 | Fact + 測定条件の注記のみ | Fact + 測定条件 + **診断的な読み**（ゾーン / Next focus / request 調査 / Pareto） |
| 出すもの | UCV / CTV / Amplification / Exact Reuse / byte 内訳 | 左記 + 参照ゾーン判定 / Next focus / request 調査の一覧 / Pareto |
| 出さないもの | 解釈・形容・見どころ抽出・派生 fact 文・合成スコア | 合成スコア・原因断定・意味推測ラベル・価値判断語（Non-Goals） |
| 位置 | 中央 5 ビュー + 右レール Requests | `/` 中央ペイン = 診断レイアウト（1〜5 パネル、ADR-0018）。左 Task list / Export は Task 見出し横へ継続 |

- **共有してよい基盤**: `computeTaskMetrics` の既存出力、`requestRows` / `exactReuseByRequest`、byte basis。
  UI が足すのは **presentation と ranking のみ**で、新しい measurement は足さない。
- **境界ルール（緩めた後も維持）**: 参照ゾーンは heuristic band であって Fact ではない旨を明示する。Next focus・request 調査の一覧は
  候補の提示であって原因の断定ではない。生 Fact（hero の数値、内訳、request 調査の一覧）とゾーン・ランキングは同居してよいが、
  後者が heuristic である旨は UI から読み取れるようにする。
- ADR-0014 から存続: ローカルデータ管理の例外（確認付き Task 削除）、意味的分類の非推定、合成スコア禁止、3 ペイン、
  `Claude Code adapter · not Core Measurement` 注記。

---

## Metrics

| 表示 | 定義 | tier | 備考 |
|---|---|---|---|
| Context Amplification | `CTV / UCV`（Application Context, deterministic） | Fact (Deterministic) | 大きく表示、ゾーン色 |
| CTV / UCV | 実測 | Fact | |
| 重複文脈バイト（per request） | `applicationBytes_i × exactReuseRatio_i` | Derived Fact | `Σ = CTV − UCV`。加法・O(N)・決定的。主指標 |
| gap 占有率 | `重複文脈バイト_i / (CTV − UCV)` | Derived Fact | request 単位、合計 100% |
| running amplification 線 | running `CTV / UCV`（rescale なし） | Derived | 「近似」と明示 |
| Slope / First 5x | running-amp の傾き / 5x 到達 request | Derived（読解補助） | |
| ゾーン OK / Watch / Warning / Critical（1-2 / 2-5 / 5-10 / 10x+） | heuristic band | **Diagnosis** | 参照ライン。Fact ではない旨を UI に明示 |
| Next focus（thread / request / breach） | 重複順・Pareto・到達点からの選択 | **Diagnosis** | |

- **leave-one-out は不採用**。倍率上の差分（"+0.42x"）は非加法で、request 数が増えると 1 本あたりが 0 に潰れて順位が意味を持たない。
- 寄与の大きさは常に **byte（重複文脈バイト）と gap 占有率**で表す。倍率換算はしない。

---

## Screen Structure

```
task-head          Task id + Export（<details>、パネル番号なし、ADR-0018）
hero               Current amplification（ゾーン色）+ 判定メトリクス（Slope / First 5x / 重複文脈バイト / 重複最大 req）
Next focus         最初に見る場所: thread / request / breach の 3 枚（ADR-0017: クリックでその thread / request へ）
request 調査+detail 集中度サマリ + 折りたたみ Pareto、一覧⇄タイムライン切替（ADR-0018 で統合。切替は選択・
                   ページ・ソートを保持）。隣にインライン Request detail（`.two-col`）
推移・閾値          running-amp 折れ線 + 参照帯（1–2x / 2–5x / 5–10x / 10x 以上、ADR-0017）+ First 5x マーカー
重複文脈の内訳      一意 UCV vs 重複（thread 別）の 100% 積み上げバー + thread 分散行（transported 内訳 + 重複 + gap%）
```

- detail は**インラインパネル**（ドロワーにしない）。常時 1 件表示、初期は重複文脈バイト最大の request を選択。
- thread lanes: 行 = thread（重複順）、横 = request 順、**●の面積 = 重複文脈バイト**（C3 の delta オフセットではない）。
- ADR-0018 前は「重複の多い request」ランキング・タイムライン・request 表が独立した 3 パネルだった。
  統合後は「request 調査」1 パネル内の一覧/タイムライン表示切替になり、Request detail は常にその隣。

---

## Reading Order

1. Current amplification の色（ゾーン）を見る
2. Next focus で最初の確認先を決める
3. request 調査の集中度サマリ・一覧で「どの request」を絞る（Pareto: 上位 N 件で大半）
4. すぐ隣の Request detail でその request の根拠（thread 偏り / gap 占有率 / new vs 重複）を読む
5. 必要なら request 調査をタイムライン表示に切り替え、thread lanes で「いつ・どの thread で積んだか」を見る
6. 推移で悪化の到達点（First 5x）を見る
7. 重複文脈バイトの内訳で「再送が何割 / どの thread」を見る

---

## Terminology Decisions

| 語 | 判断 | 理由 |
|---|---|---|
| **重複文脈バイト** | **採用**（主指標語） | 「重複」= 明確にマイナス方向 / 「文脈」= 何が重複しているか（＝打ち手の対象） / 「バイト」= 単位。tight な箇所は「重複」「重複文脈」に短縮可 |
| 寄与 | 不採用 | 日常語で "良い方向への貢献" を含意し、悪化要因の呼称に不適。統計語（寄与度 / 寄与率、マイナス寄与あり）として通す案もあるが、読み手が日常語で取ると誤読（「マイナスなのに寄与？」） |
| 再送バイト | 不採用 | ネットワークの TCP retransmission と衝突し、byte 指標として誤読を招く。初期 C4 で使用 → C3.5 / C5 で撤回 |
| Final impact / leave-one-out | 不採用 | 倍率上の差分は非加法。request 数が増えると 1 本あたりが 0 に潰れ順位が無意味。加法分解（`Σ = CTV − UCV`）に統一 |
| 削減候補 | 採用 → **改称（ADR-0017）** → **統合（ADR-0018）** | フレーム（原因断定ではなく「最初に開く request」の順位）は不変。語が「削減して当然」と読ませるため、パネル名を「重複の多い request」に変更(ADR-0017)、さらに ADR-0018 でタイムライン・request 表と統合し **「request 調査」** に改称 |
| OK / Watch / Warning / Critical | 採用 → **置換（ADR-0017）** | 評価語が「高倍率 = 異常・無駄・削減可能」と誤読させる。倍率レンジ表記 **`1–2x` / `2–5x` / `5–10x` / `10x 以上`** に置換。帯の色は維持し、「倍率は deterministic・帯の閾値は heuristic」を分離明示 |
| 「この request を除くと CTV−UCV が N 減る」 | **不採用（ADR-0017）** | request 除外で一意 context の集合と後続の再利用判定が変わるため、観測済みの重複量を反実仮想の削減効果に読み替えている。「この request で観測された重複文脈バイト」に統一 |

---

## Interactions

- **フィルタ 2 軸**: sort（重複文脈バイト / reuse比 / request順）、thread（`unknown` 含む）。
  ページサイズ（20 / 50 / 100、既定 20、ADR-0018 — 旧 topN トグルを置換）。複合フィルタはしない。
- **選択**: request 調査の一覧行 / Next focus カード / minimap・lanes の点 のクリック → 共通の detail パネルに反映(ADR-0018)。
- **表示切替**: request 調査内で「一覧⇄タイムライン」を切り替えても、選択中の request・一覧のページ・
  ソート順は保持される(ADR-0018)。
- **thread フィルタ**: lanes は非該当レーンをディム。一覧・推移が当該 thread に追従。タイムライン経由で
  フィルタ対象外の request を選ぶと、フィルタがその request の thread へ切り替わる(`all` への解除では
  ない — Next focus のカードと同じ慣習、ADR-0018)。内訳バーは task 全体のまま
  (block↔thread 対応は測定範囲外、本線 §4 と同じ扱い)。
- **タイムライン**: 既定 minimap。`thread lanes` は opt-in トグル（詳細探索時のみ）。切替でキャプション（`#tl-note`）も差し替え。
- **Pareto の k50 / k80**: 全体基準（thread フィルタ非追従）。その旨ラベルに明示。
- **URL query**: task / filter を持たせて共有・リロードで復元（本線 §4 と同じ流儀）。
- **write path なし**: 再計測・設定変更・数値書き換えをしない（本線と同じ）。

---

## Non-Goals

- 合成スコア（複数シグナルを 1 つの health score にまとめる）。Review Churn（ADR-0004）と同じく単一スコア化しない。
- 意味推測ラベル（「これは自動メモリ評価」「context replay 型」「cold cache start」等）。
- 原因断定（「この request が原因」）。あくまで「最初に見る候補」。
- 新しい measurement の追加。presentation / ranking のみで、core は `computeTaskMetrics` の既存出力。
- token basis（byte basis のみ。本線と同じ）。
- multi-task をまたぐ比較（spec §14.6 は別途）。

---

## Open Questions

- ゾーン閾値（2 / 5 / 10x）はユーザー設定可にするか、固定参照ラインか。
- request 調査の「残り N 件 = X%」をフィルタ内基準で出すか（C5 / ADR-0018 は Pareto 全体基準のみ）。
- thread lanes を狭い two-col セルに置き続けるか、詳細探索時は全幅にブレイクアウトするか。
- spec §13 の warning 群（High context retransmission / Repeated tool output / …）とこの画面の統合単位。
  warning を Next focus の入力にするか、別レーンで並置するか。
- running-amp 線（近似）を出す価値。honest だが「なぜ近似を見せるのか」を問われる。
- server-side conversation state を使う API（Codex Responses 等）では Context Amplification 自体が known limitation（spec §… / CONTEXT.md）。その場合この画面が何を出すか。
