# UI 読み方ガイド

観測 UI（`/`）を見る利用者向けの読み方ガイドです。各パネル・指標が何を測っていて、どの範囲の値で、
何が言えて何が言えないかをまとめます。実装の設計仕様（データ構造・コンポーネント構成など）は
[`docs/ui-information-design.md`](ui-information-design.md) を参照してください。

## このガイドの前提

token-profiler の観測 UI がすることは、**観測値の提示**と、その**診断的な読み**（重複の多い
request・thread の機械的な提示まで）です。以下はしません。

- 原因の断定（「この request が原因」「ここが無駄」）。
- 改善の優先順位付けや推奨アクションの提示。
- 「支配的」「無駄」「overhead」等の価値判断。
- 用途名や意味の推測（`context replay 型` 等のラベル付け）。

UI 中の ❔ アイコンは、指標の**意味・単位・集計範囲**を 1 文で補足するだけです。計算式や具体例、
「何が言えて何が言えないか」の詳しい説明はこのガイドに置きます。ページ内の見出しには
`<a id="...">` の明示アンカーを置いているので、❔ の「詳しい説明」リンクは該当する見出しへ直接
ジャンプします。

---

<a id="sec-1-current-amplification"></a>
## 1. Current amplification

このパネルは、Task 全体の Context Amplification（CTV / UCV の比）と、その判定に使う指標をまとめた
ものです。すべて **byte basis**（トークンではなくバイト数）の観測値で、原因の断定ではありません。

- **UCV**（Unique Context Volume）: Task 全体で一意と判定された application context バイト数の合計。
- **CTV**（Cumulative Transported Volume）: Task 全体で送信された application context バイト数の合計。
- **重複文脈バイト（gap）**: `CTV − UCV`。同じ内容が重複して送信されたと判定されたバイト数の合計。

<a id="metric-current-amplification"></a>
### Current amplification（score box）

`Amplification = CTV ÷ UCV`。「同じ情報が Task 内で何倍 transport されたか」を表す倍率です。
CTV / UCV 自体は deterministic な観測値ですが、右側に表示される参照帯（`1–2x` / `2–5x` / `5–10x` /
`10x 以上`）の色分けの**閾値は heuristic**（目安）であり、Fact ではありません。倍率が大きいことは
それ自体で「無駄」「削減可能」を意味しません — 同じ情報を何度も送る設計が必要な場面もあります。

<a id="metric-slope"></a>
### Slope

`(最終 request の running amplification − 最初の request の running amplification) ÷ (request 数 − 1)`。
running amplification（下記「4. 推移・閾値プロット」参照）が request 1 件進むごとに平均どれだけ
変化したかです。Task 全体を通した平均変化量であり、直近の傾向とは異なることがあります。

<a id="metric-first5"></a>
### First 5x

running amplification が初めて 5 倍以上になった request の番号（`requestIndex`）です。到達していない
場合は「未到達」と表示します。5x という閾値は他の参照帯と同じ heuristic な目安です。

<a id="metric-dup-bytes"></a>
### 重複文脈バイト（メトリクスタイル）

Task 全体で重複と判定された application context の総バイト数（`Σ ≒ CTV − UCV`）。上のパネル説明の
「重複文脈バイト（gap）」と同じ値です。

<a id="metric-top-req"></a>
### 重複最大 req

重複文脈バイトが最大の request の番号です。「2. Next focus」の Request カードと同じ request を指し
ます。

<a id="metric-cache-read-share"></a>
### Cache read share (billing axis)

`cache_read_input_tokens ÷ (uncached input + cache_creation + cache_read)` の比率です。**この 3 項目
すべてを報告した request だけ**を対象に算出します。一部の request しか報告していない場合は
「(n/total 件で算出)」という注記が付きます。何も報告されていない場合は「不明」（0% ではありません）。

<a id="metric-ucv-ctv"></a>
### UCV / CTV

パネル冒頭の説明のとおり、UCV = 一意な application context バイト数、CTV = 送信された application
context バイト数。いずれも Task 全体の合計です。

<a id="metric-classification-coverage"></a>
### Classification Coverage

分母は送信バイト全体（`application` + `protocol` + `unknown` の合計）、分子は `application` と
`protocol` に分類できたバイト数です（`unknown` は分母にのみ含み、分子には含みません）。100% に
満たない分がそのまま `unknown`（transport を分類できなかった分）にあたります。95% 未満のときは
UI 上に注記が出ますが、これは分類の網羅性についての注記であり、Amplification の値そのものへの
評価ではありません。

### 何が言えて何が言えないか

- 言えること: 「Task 内でどれだけの application context が重複して送信されたか」という観測事実と、
  その規模のランキング。
- 言えないこと: 重複や倍率が大きいことは、それ自体では「無駄」でも「削減可能な量」でもありません。
  同じ context を毎 request 再送する設計（例: サーバ側に会話状態を持たない client）であれば、
  Amplification が高くなるのは構造上自然なこともあります。この UI は削減の是非や優先順位を判定しません。

---

<a id="sec-2-next-focus"></a>
## 2. Next focus

3 枚のカードは、次の基準で**機械的に**選ばれた候補です。原因の断定や改善の優先順位付けではありません。

- **Thread**: 重複文脈バイトの合計（gap への寄与）が最大の thread。
- **Request**: 重複文脈バイトが最大の request（「1. Current amplification」の「重複最大 req」と同じ）。
- **Breach**: running amplification が初めて 5 倍を超えた request（「First 5x」と同じ）。

カードをクリックすると、対象の thread へフィルタが切り替わる、または対象の request が
Request detail に選択されます。カードが選ぶのは「重複文脈バイトの順位」と「running-amp が閾値を
超えた地点」だけで、なぜ重複が起きたか・次に何をすべきかは含まれません。

---

<a id="sec-3-request-explorer"></a>
## 3. request 調査

request の一覧とタイムラインは、同じ選択・並び順を共有する**表示切替**です（別々のデータではありま
せん）。既定は重複文脈バイトの降順で、選んだ 1 件の詳細が隣の Request detail に表示されます。

<a id="metric-concentration"></a>
### 集中度サマリ（Pareto、k50 / k80）

「上位 `k80` 件の request で重複文脈ボリューム全体の 80% / 上位 `k50` 件で 50%」という文で、重複が
少数の request に集中しているか、広く分散しているかを示します。`k50`/`k80` は現在のフィルタに関わらず
**Task 全体を基準**に計算されます（フィルタで絞った一覧だけを基準にした値ではありません）。
折りたたみの「集中度グラフ（Pareto）」はこれを累積グラフで示したものです。

### 何が言えて何が言えないか

- 言えること: どの request / thread に重複文脈バイトが集中しているか。
- 言えないこと: 「上位 N 件を無くせば N 件分のバイトが削減できる」という反実仮想の計算はできません。
  ある request を除外すると、以降の request の一意 context 集合や重複判定そのものが変わるため、
  単純な差分では削減量になりません。

---

## Request detail

一覧・タイムライン・Next focus のいずれからも request を選ぶと、この隣接パネルに詳細が表示されます。

<a id="reqdetail-dup-bytes"></a>
- **重複文脈バイト**: この request の application bytes のうち、既出の Exact Fingerprint と一致した
  （重複と判定された）バイト数。
<a id="reqdetail-gap-share"></a>
- **gap 占有率**: この request の重複文脈バイトが、Task 全体の重複文脈バイト合計（gap）に占める割合。
<a id="reqdetail-rank"></a>
- **重複文脈バイト順位**: 重複文脈バイトの降順で並べたときのこの request の順位（分母は Task 全体の
  request 数）。
<a id="reqdetail-reuse-ratio"></a>
- **exact reuse ratio**: この request の application bytes のうち重複と判定された割合
  （`dupBytes ÷ appBytes`）。
<a id="reqdetail-running-amp"></a>
- **running amplification**: この request までの累積 CTV ÷ 累積 UCV（下記「4. 推移・閾値プロット」の
  近似再計算）。

この request を除外した場合の削減量としては読みません。理由は「3. request 調査」の集中度サマリと
同じで、除外すると以降の一意 context 集合・重複判定が変わるためです。

---

<a id="sec-4-amp-chart"></a>
## 4. 推移・閾値プロット

running amplification（累積 CTV ÷ 累積 UCV）を request の順に**近似再構成**した折れ線です。
「近似」というのは、最終的な Amplification の値へ後から rescale する処理をしていないという意味です
（各点はその時点までの累積値そのもの）。背景の帯（`1–2x` / `2–5x` / `5–10x` / `10x 以上`）は
「1. Current amplification」と同じ参照ラインで、閾値は heuristic です。破線は「First 5x」の地点を
示します。

---

<a id="sec-5-reuse-breakdown"></a>
## 5. 重複文脈バイトの内訳

増幅分（`CTV − UCV`）を thread 別に分けた内訳バーと、`application` / `protocol` / `unknown` の
転送内訳、thread ごとの重複文脈バイト・gap 占有率の表です。

- 内訳の大きさは「gap 占有率」（Task 全体の重複合計に対する割合）で見るものです。無駄や削減可能量
  ではありません。
- thread ごとの内訳は Claude Code adapter が推定した `verified_best_effort` の対応付けで、
  Core Measurement（プロトコルから直接読み取れる値）ではありません（下記「診断的な読み全体の限界」
  も参照）。

---

## 診断的な読み全体の限界

参照ゾーン・Next focus・request 調査の集中度サマリ・running-amp の折れ線は、いずれも
**heuristic な読み**であり、Fact（CTV / UCV / Amplification / Exact Reuse / byte 内訳などの生の観測値）
とは区別して読んでください。

- **参照帯の閾値**（2x / 5x / 10x）は目安であり、Fact ではありません。
- **thread（Conversation Thread）** はプロトコルに明示された値ではなく、Claude Code 用の
  Enrichment Adapter による推定（`verified_best_effort`）です。Core Measurement には含まれません。
- **`unknown` は分母から落としません**。`context_class=unknown` や `thread=unknown` も、割合・件数
  として明示されます。
- **server-side に会話状態を保持する API**（例: 一部の Responses 系 API）では、Context Amplification
  が測るのは「request の payload に載った context」だけです。provider 側にのみ保持され、再送されない
  context は観測できません。
- **Amplification / Exact Reuse / byte 数の Task 間比較**は、同じ Measurement Profile で取得した
  Task 同士に限ります。

---

## 関連ドキュメント

- [`docs/ui-information-design.md`](ui-information-design.md) — 実装者向けの UI 情報設計（正本）。
- [`docs/STATUS.md`](STATUS.md) — 今できること / 未実装 / 既知の限界の早見表。
- [`docs/adr/0016-ui-diagnostic-reading.md`](adr) など `docs/adr/` — ADR-0013（Claude Code thread
  adapter）、ADR-0016（診断的な読みを主にする）、ADR-0017（根拠の近接・評価語の記述化）、
  ADR-0018（request 調査パネルの統合・ページング）。
