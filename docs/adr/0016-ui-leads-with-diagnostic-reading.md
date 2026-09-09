---
status: accepted (§3.2/§3.5/§3.6/§3.7/§3.9 amended by ADR-0017; §Decision panel list further revised by ADR-0018)
---

# 観測 UI は Context Amplification の診断的な読みを主にする(ADR-0014 の Fact-only 決定を上書き)

> ADR-0017 が本 ADR の一部を改訂した: `.two-col`(タイムライン + Request detail)を「重複の多い
> request」ランキングの直後・request 表の前に移動、Next focus のカードをクリック可能に、参照ゾーンの
> 評価語(OK/Watch/Warning/Critical)を倍率レンジ表記に置換、パネル 5 を「削減候補」→「重複の多い
> request」に改称、RequestDetail の「除くと CTV−UCV が減る」文言を撤回。骨子・Non-Goals は不変。
>
> ADR-0018 がさらに §Decision のパネル列挙を改訂した: パネル 5(重複の多い request)・6(タイムライン)・
> 7(request 表)を「3 · request 調査」に統合し、Export をパネル番号から外して Task 見出し横へ移動
> (詳細は ADR-0018)。骨子・Non-Goals は不変。

1. ADR-0014 は観測 UI(`token-profiler ui` / `wrap` 相乗り UI)を **Fact レイヤーの値と測定条件の注記だけ**に絞り、Hotspots 相当の解釈・見どころ抽出・合成スコアを撤去した。狙い(観測と判断の分離)は妥当だったが、dogfooding を重ねると「Context Amplification が高いのは分かる。で、**どこから悪化した / 次にどの request を見る**のか」を利用者が毎回ゼロから Requests テーブルと Export で組み立てる負荷が恒常的に残った。ADR-0014 §Consequences 自身が「観測 UI が『調査の入口』になった」と認めており、その入口の導線が弱いまま据え置かれていた。

2. `abtest-a` / `-b` / `-c1..-c5`(→ `docs/ui-diagnostic-concept.md`, `abtest-c5.html`)で、この導線を **加法分解ベースの診断的な読み**として設計・検証した:
   - 重複文脈バイト(per request)= `applicationBytes_i × exactReuseRatio_i` ≒ `exactReuseByRequest[i].reusedBytes`(server 既算)。`Σ ≒ CTV − UCV`。加法・O(N)・決定的。
   - 「どの request が積んでいるか」は検索ではなく **重複文脈バイト降順のランキング + Pareto**(「上位 K 件で再送ボリュームの X%」)。
   - 参照ゾーン(OK 1-2x / Watch 2-5x / Warning 5-10x / Critical 10x+)と Next focus(thread / request / breach の機械的な指し示し)。
   C5 を採用形とした(`docs/ui-diagnostic-concept.md` の採用判断)。

3. C5 は **新しい measurement を足さない**。`computeTaskMetrics` の出力(`ucv` / `ctv` / `contextAmplification` / `requestRows` / `exactReuseByRequest` / `threadBreakdown`)をそのまま presentation と ranking で読ませるだけ。Core Measurement の計算式・値は一切変わらない。

4. ADR-0014 §Consequences は「Hotspots 相当を将来再導入するには本 ADR を supersede する ADR が必要。これは意図的な摩擦」と明記していた。本 ADR がそれ。ただし ADR-0014 の全部を覆すのではなく、**Fact-only の decision 部分だけ**を上書きし、意味的分類の非推定・合成スコア禁止・ローカルデータ管理の例外は引き継ぐ(下記「ADR-0014 との関係」)。

## Decision

`/`(`token-profiler ui` および `wrap` 相乗り UI)の中央ペインを、C5 の診断的レイアウトにする。パネル順
(ADR-0017 で 5〜7 を改訂: パネル 5 を「重複の多い request」に改称、`.two-col` を 5 の直後・request 表の
前に移動):

1. **Current amplification** — 大きい数値 + ゾーン色。判定メトリクス行(Slope / First 5x / 重複文脈バイト合計 / 重複最大 req)。
2. **Next focus** — 最初に見る場所: thread / request / breach の 3 枚(ADR-0017 でクリック可能に)。
3. **推移・閾値プロット** — running amplification 折れ線 + 参照帯(1–2x / 2–5x / 5–10x / 10x 以上、ADR-0017)+ First 5x マーカー。
4. **重複文脈バイトの内訳** — 一意 UCV vs 重複(thread 別)の 100% 積み上げ + thread 分散行。application / protocol / unknown の transport 内訳もここに残す。
5. **重複の多い request**(旧「削減候補」、ADR-0017) — Pareto(累積 gap 占有 + k50 / k80 線)+ ランキング(sort: 重複文脈バイト / reuse 比 / request 順、thread filter、topN)。
6. **タイムライン + Request detail**(`.two-col`、ADR-0017 で 5 の直後へ) — minimap(既定)⇄ thread lanes(opt-in トグル)。縦・面積 = 重複文脈バイト。クリックで隣の Request detail を更新。
7. **request 表** — 最後の確認場所。生行、既定ソートは重複文脈バイト順。
8. **Export** — 変更なし。

情報設計の詳細は `docs/ui-information-design.md` を新 IA に書き換えて定義する。

### ADR-0014 から緩めるもの(= 出してよくなるもの)

- **参照ゾーン** OK / Watch / Warning / Critical。heuristic band であって Fact ではない旨を UI 上に明示する。閾値(2 / 5 / 10x)は将来ユーザー設定可にする余地を残す。(ADR-0017: 評価語を倍率レンジ表記 `1–2x` / `2–5x` / `5–10x` / `10x 以上` に置換。帯の色は維持。)
- **Next focus の選択** — 重複文脈バイト順・Pareto・running-amp の到達点から、機械的に「最初に見る thread / request / breach」を指す。原因の断定ではなく候補の提示。
- **「削減候補」というフレーム** — ランキングを「原因」ではなく「まず開く request」として提示する。(ADR-0017: パネル名を「重複の多い request」に改称。フレームは不変。)
- **読解補助メトリクス** — Slope(running-amp の傾き)、First 5x(5x 到達 request)。
- **running amplification 線** — running `CTV / UCV`(target への rescale なし)。「近似」と明示。

### ADR-0014 から維持するもの(= 引き続き出さないもの)

- 合成 health スコア(複数シグナルを 1 つのスコアにまとめること)。
- 原因の断定(「この request が原因」「ここが無駄」)。
- profiler が検証できない用途名・意味的分類(`background/helper candidate`、`context replay 型`、`cold cache start` 等)。
- 「無駄」「overhead」「支配的」等の価値判断・形容。
- 複数点から形を言い当てる散文(「単調増加して収束」等)。

### Fact は Fact のまま

- `computeTaskMetrics` の計算式は不変。
- 生値(UCV / CTV / Context Amplification / Classification Coverage / byte 内訳 / Observed token 数 / per-request 生行 / thread breakdown)は hero・内訳パネル・request 表・Export で従来どおり参照できる。**測定値は何も失われない。フレームが変わるだけ。**
- 主指標語は「重複文脈バイト」。「寄与」「再送バイト」「Final impact / leave-one-out」は不採用(`docs/ui-diagnostic-concept.md` の用語決定ログ)。(ADR-0017: RequestDetail の「この request を除くと CTV−UCV が減る」という反実仮想の言い回しも撤回し、「この request で観測された重複文脈バイト」に統一。)

## ADR-0014 との関係

ADR-0014 の frontmatter を `status: superseded by 0016 (partial)` に変更する。上書きされるのは **「read-only の観測 UI は Fact レイヤーの値と測定条件の注記だけを提示する」という decision と、その v0 適用(Hotspots 撤去 / Breakdown は数値のみ / Timeline は折れ線のみ)** の部分。

引き続き有効(本 ADR は緩めない):

- **ローカルデータ管理操作の例外** — 明示確認で gate された Task 削除が唯一の write path。`local data` バッジ、`ended_at IS NULL` の無効化、`POST /api/tasks/:id/delete` の `confirmTaskId` 一致チェック、削除時のみ短命 read-write ハンドル。
- **意味的分類・用途名を推測しない**原則(ADR-0011 由来)。
- **合成スコアを作らない**原則。
- **3 ペイン構成** — 左 Task list / 中央(診断)/ 右 request 系。URL query に選択・filter を持たせる。
- Conversation Threads の `Claude Code adapter · verified_best_effort · not Core Measurement` 注記(ADR-0013)。

## Considered Options

- **C5 を 6 観測ビューの裏のトグル(別モード)として足す**: 却下。ADR-0014 §Considered が「中途半端なトグルは同じ混同を招く」とした通り。診断的な読みを主にすると決めた以上、既定にする。Fact は消えず hero / 内訳 / request 表 / Export に残るので、「別モードで生値を見る」必要がない。
- **ADR-0014 を維持し、C5 は別 UI ないし MCP 経由の Agent 自己診断(spec §19.3)だけに置く**: 却下。dogfooding の主対象が `/` であり、そこが既に「調査の入口」になっている。入口の導線を別プロダクトに切り出すのは過剰。
- **現状維持(ADR-0014 のまま)**: 却下。上記 1 の dogfooding 負荷が解消されない。
- **`docs/` だけ直して ADR を起こさない**: 却下。ADR-0014 が明示的に supersede ADR を要求している。決定として記録し、Fact-only へ戻すにはさらに supersede を要求する(意図的な摩擦)。

## Consequences

- **`docs/ui-information-design.md`** を新 IA に全面改訂。§0–§4(目的 / 表現ルール / 画面構成 / ビュー定義 / フィルタ)を差し替え、§5(metrics.ts が UI へ渡すもの)は **変更不要**(重複文脈バイト = `exactReuseByRequest[].reusedBytes`、running-amp は `requestRows[].applicationBytes` と併せて client で決定的に再構成)、§6(build / 配布)は据え置き、§7(動作確認)・§8(未決)を新パネルに合わせて更新。
- **`docs/ui-diagnostic-concept.md`** の Position / Relationship To Observation UI を「別トラック・本線に混ぜない」→「これが `/` の情報設計そのもの。ADR-0016 + `ui-information-design.md` が spec」に反転。Metrics / Screen Structure / Reading Order / Terminology Decisions / Interactions / Non-Goals / Open Questions は存続。
- **spec §14 UI** を新レイアウトに合わせて更新。**spec §13 Expert Diagnostics**(High context retransmission 等の warning 群)は引き続き将来機能で、本 ADR は §13 を実装しない(§13 の一部の「読み」を UI 標準の導線として先取りした、という関係)。
- **`CONTEXT.md` 冒頭** と **`package.json` description** を、ADR-0014 で「観測に徹する / 解釈は利用者」に振り切った表現から「観測値と、その診断的な読み(削減候補の提示まで。原因断定・合成スコアはしない)」へ再調整。
- **`src/ui/client/`**: 中央ペインを刷新。純関数 `diagnostic.ts`(重複文脈バイト / gap 占有率 / zone(+name+color) / running-amp 系列 / Pareto k50・k80 / Next focus の選択)+ 新コンポーネント(`Amplification` / `NextFocus` / `AmpChart` / `ReuseBreakdown` / `ReductionCandidates` / `Timeline` 改修 / `RequestDetail`)。`Requests`(生行)/ `ExportPanel` / `Filters` / `TaskList` / `Header` は維持。タイムラインモード・ランキング sort は URL に持たせず component state(現行の `reqSort` と同じ扱い)。
- **`src/ui/server.ts`**: 新エンドポイント不要(データは既に十分)。`/` の shell 配信は変更なし。
- **テスト**: `src/ui/client/**/*.test.tsx` を新パネルに書き換え、`diagnostic.ts` のユニットテストを追加(重複文脈バイト合計 ≒ CTV − UCV、gap 占有率の総和 = 1、zone 閾値、Pareto k80/k50)。`test/ui-server.test.ts` の「bundle に Hotspots / 『構造的に支配的』が無い」系アサーションを、新パネル名の存在 +「合成スコア / 原因断定ラベルが無い」に更新。
- Fact-only へ戻すには本 ADR を supersede する ADR が必要(ADR-0014 と同じ意図的な摩擦)。
