# localhost UI — 情報設計

`/` の観測 UI の情報設計。Context Amplification の**診断的な読み**(参照ゾーン / Next focus / request 調査)を主にする(ADR-0016 が ADR-0014 の Fact-only decision を上書き。ADR-0017 が §3.2/§3.5/§3.6/§3.7/§3.9 を改訂。ADR-0018 がパネル構成をさらに統合・改番)。

- **中央 = 診断パネルの単一カラム**: Current amplification → Next focus → request 調査(一覧⇄タイムラインの表示切替 + 選択 request の詳細、この2枚だけ横並び)→ 推移・閾値プロット → 重複文脈バイトの内訳。左は Task list。選択 request の詳細はページ全体に張り付く sticky サイドバーには**しない**(調査パネルの隣だけに置く、ADR-0016)。Export はパネル番号を持たず、Task 見出し横の `<details>` に置く(ADR-0018)。確認付きの Task 削除が唯一の write path、バッジは `local data`。`wrap` が `127.0.0.1:7331` に相乗り起動、5 秒 polling + Refresh。poll が失敗したらヘッダに「取得失敗・表示は最新でない可能性」マーカー。
- **新しい measurement は足さない**。`computeTaskMetrics` の出力(`ucv` / `ctv` / `contextAmplification` / `requestRows` / `exactReuseByRequest` / `threadBreakdown`)を presentation と ranking で読ませるだけ。Core Measurement の計算式・値は不変。
- **クライアントは `src/ui/client/`(Preact + Vite)**。`npm run build` で `dist/ui/`(`index.html` + hashed `assets/*.js|css`)を生成し `src/ui/server.ts` が配信(ADR-0015 の A を実装済み。`dist/ui/` は非版管理。Release tarball 同梱の配布 CI = B は未着手。§6 / §6.1)。

実装: `src/ui/server.ts` + `src/ui/index.html`(Vite シェル)+ `src/ui/client/`(Preact app、`diagnostic.ts` = 純関数の診断ロジック)+ `src/ui/export.ts`, `src/core/metrics.ts`(`RequestRow` に class byte / reuse ratio 追加), CLI `token-profiler ui [--port] [--db]`, `token-profiler wrap [--no-ui] [--ui-port]`, `vite.config.ts` / `vitest.config.ts`, test `test/ui-server.test.ts`(`node --test`)+ `src/ui/client/**/*.test.tsx`(Vitest + jsdom)。
関連: **ADR-0016(UI leads with a diagnostic reading)**, **ADR-0017(根拠の近接・評価語の記述化 — §3.2/§3.5/§3.6/§3.7/§3.9 を改訂)**, **ADR-0018(request 調査パネルの統合・ページング — パネル構成とパネル順を改訂)**, ADR-0014(partial superseded — 存続部分は §1 / §4), spec §14(UI), §13(Expert Diagnostics — warning 群は将来), ADR-0005(Core / Enrichment 分離), ADR-0011(context_class / Fact・Diagnostic 分離), ADR-0013(Claude Code thread adapter), ADR-0015(UI client build step + release-tarball distribution)

---

## 0. 目的とスコープ

`token-profiler report <task_id>` が出す測定値を DB からブラウズし、かつ **同一 Task 内で Context Amplification がどこから・何によって悪化したか、次にどの request を見るか** を、ランキングとゾーン判定で指し示す localhost app。再計測・設定変更・数値の書き換えはしない。唯一の write path は明示確認で gate された Task 削除(ADR-0014 §「ローカルデータ管理操作の例外」、ADR-0016 で存続)。それ以外の read はすべて read-only ハンドル経由。

このプロファイラの役割は **観測値の提示と、その診断的な読み(重複の多い request の提示まで)**。以下はしない(ADR-0016 で ADR-0014 から存続):

- 合成 health スコア。
- 原因の断定(「この request が原因」「ここが無駄」)。
- profiler が検証できない用途名・意味的分類(`background/helper candidate`、`context replay 型`、`cold cache start` 等)。
- 「無駄」「overhead」「支配的」等の価値判断・形容。
- 複数点から形を言い当てる散文(「単調増加して収束」等)。

参照ゾーン・Next focus・request 調査の一覧は **heuristic な読み** であり、その旨を UI から読み取れるようにする(§1)。

UI 利用者向けの読み方ガイド(パネル・指標の意味・計算方法・「何が言えて何が言えないか」)は
[`docs/ui-reading-guide.md`](./ui-reading-guide.md) を参照(本書は実装者向けの設計仕様)。

v0 でやること:

- `profiler.sqlite` を **read-only** ハンドルで開く(削除時のみ短命の read-write)
- Task 一覧を出す(各行に確認付き削除)
- Task を1つ選ぶと `report` 相当の測定値 + 診断レイアウト(§3)を表示する
- フィルタは **All traffic / thread / context_class** の3軸。thread フィルタは request 調査(一覧・タイムライン lanes とも)のスコープにもなる
- `wrap` 実行中は 5 秒間隔の polling + 手動 Refresh で最新化する

v0 でやらないこと(将来 spec §11–§14):

- Token Flamegraph / Flow Graph / Task Comparison
- spec §13 Expert Diagnostics の warning 群(High context retransmission 等の列挙)
- 合成スコア・原因断定・意味推測ラベル(ADR-0016 Non-Goals)
- token basis(ローカル tokenizer 未実装、byte basis のみ)

---

## 1. 設計原則(UI 表現ルール)

ADR-0016 で「Fact + 診断的な読み」を出せるようになった。Fact と heuristic な読みは同居してよいが、後者が heuristic である旨は UI から読み取れるようにする。

| ルール | 具体 |
|---|---|
| **Fact は Fact として断定する** | UCV / CTV / Context Amplification / Exact Reuse / Classification Coverage / byte 内訳 / Observed token / per-request 生行 / thread breakdown。測定値。 |
| **重複文脈バイトは Derived Fact** | per request = `applicationBytes_i × exactReuseRatio_i` ≒ `exactReuseByRequest[i].reusedBytes`。`Σ ≒ CTV − UCV`。加法・決定的。ランキング・Pareto・内訳バーの基盤。 |
| **診断的な読みは heuristic と分かる形で出す** | 参照ゾーンは倍率レンジ表記(`1–2x` / `2–5x` / `5–10x` / `10x 以上`、ADR-0017 — 評価語 OK/Watch/Warning/Critical は使わない)。帯の色は残すが「倍率 CTV/UCV は deterministic、帯の閾値は heuristic」を分離して明示し Fact の数値と混同させない。Next focus・request 調査の集中度サマリは候補の提示であって原因の断定ではない、と読めるラベルにする。Slope / First 5x / running-amp 線は読解補助で、running-amp は「近似」と明示。 |
| **原因断定・価値判断・意味推測はしない** | 「支配的」「無駄」「replay 型」「cold cache start」「background/helper」等は書かない。 |
| **合成スコアを作らない** | 複数シグナルを1つの health 数値にまとめない。 |
| **Core と Enrichment を視覚的に分ける** | thread 由来の表示には `Claude Code adapter · verified_best_effort · not Core Measurement`(ADR-0013)。 |
| **unknown を隠さない** | context_class=unknown、thread=unknown は割合・件数を明示。分母から落とさない。 |
| **basis を常時表示** | 全数値に `byte basis` バッジ。 |
| **セクションごとの自己解説 prose は書かない**(ui-review §3) | 出してよいのは見出し・パネル名・列ラベル・空状態(`No requests` 等)・短いバッジ(`byte basis` / `local data`)・ボタン/リンクラベル・破壊的操作の警告・測定条件の注記・診断的な読みが heuristic である旨の1行まで。 |

---

## 2. 画面構成

```
┌──────────────────────────────────────────────────────────────────┐
│  token-profiler   [byte basis] [local data]  updated hh:mm [取得失敗?] │
├───────────────┬────────────────────────────────────────────────────┤
│  Task list    │  <task id>                              [Export ▾] │
│               │  Filter: (•)All ( )thread ( )ctx                  │
│  #<taskid> ▸ ×│  1. Current amplification                          │
│  #<taskid>   ×│  2. Next focus  (カードクリックで該当 thread/req)  │
│  #<taskid>   ×│  3. request 調査 [一覧|タイムライン]                │
│  ...          │ ┌──────────────────────┬─────────────────────────┐ │
│               │ │ 一覧(既定, ページング) │ Request detail          │ │
│               │ │  ⇄ タイムライン       │ (行/点/カードで更新)    │ │
│               │ │  (minimap⇄lanes)      │                         │ │
│               │ └──────────────────────┴─────────────────────────┘ │
│               │  4. 推移・閾値プロット                             │
│               │  5. 重複文脈バイトの内訳                           │
└───────────────┴────────────────────────────────────────────────────┘
      narrow (<900px): 3 のペアも 1 カラムに畳む
```

- Task list はサイドバー常設。各行に per-task 削除(`×`)。実行中 Task は無効。
- Filter は中央パネル全体にかかる(full width、パネル群の上)。
- **Export はパネル番号を持たない**(ADR-0018)。Task 見出しの隣にネイティブ `<details class="export">`
  として置き、中身は §3.7 のまま。開閉のみで、閲覧中データへの操作を末尾スクロールなしで開ける。
- **中央は単一カラム**: §3 の 1・2・4・5 は縦積み(タブにしない)。**3 request 調査だけ**、一覧
  (既定)またはタイムラインのいずれかの表示と、Request detail(選択中 request の詳細)が横並びの
  `.two-col` — ページ全体に張り付く sticky サイドバーには**しない**(邪魔になるため、ADR-0016)。
  ADR-0018 が旧パネル 5(重複の多い request)・6(タイムライン単独)・7(request 表)をこの1パネルに
  統合した: 候補を知る→選ぶ→根拠を読むという調査の流れが、他パネルを挟まず1つの領域で完結する。
  表示切替(一覧⇄タイムライン)は選択 request・一覧のページ・ソートを保持したまま行われる。
  Next focus のカード・一覧の行・タイムラインの点、どれをクリックしても選択が更新され、隣の
  Request detail に反映される。狭い画面ではこの行も 1 カラムに畳まれる。

---

## 3. パネル定義

数値はすべて `computeTaskMetrics` の戻り値、または `src/ui/client/diagnostic.ts` がそれを決定的に加工したもの。`diagnostic.ts` は純関数(重複文脈バイト / gap 占有率 / zone / running-amp 系列 / Pareto k50・k80 / Next focus 選択)で、ユニットテスト対象(§7)。

### 3.1 Current amplification

**目的**: この Task の Context Amplification と、その大きさの位置づけが一目で分かる。

- **大きい数値** = `contextAmplification`(`ratio()`)。背景色 = ゾーン(§3.9)。ゾーン表示は `zoneLabel()` の倍率レンジ(`1–2x` 等)+「CTV / UCV は deterministic、帯の閾値は heuristic」(ADR-0017 — `Critical` 等の評価語は出さない)。
- 判定メトリクス行(4 枚):
  - **Slope** — running-amp の傾き(`(last − first) / (n − 1)`)。読解補助。
  - **First 5x** — running-amp が初めて 5x を超えた request index。未到達なら「未到達」。
  - **重複文脈バイト** — `Σ reusedBytes`(≒ `ctv − ucv`)。`bytes()`。
  - **重複最大 req** — 重複文脈バイト最大の request index。
- Kv は 2 グループに分ける(ADR-0017 — Task 全体値と thread スコープ値を表示領域で区別):
  - **Task 全体**(常時): Task ID / total requests / **観測スパン** / observed input・output / cache_creation・read / cache read share / `UCV / CTV` / `Classification Coverage`(<95% は黄色)。
  - **選択 thread: <id>**(thread フィルタ時のみ、小見出しで区切る): その thread の request 数 / observed input・output / cache_creation・read / cache read share。
- **観測スパン** = `requestRows` の有効な `timestamp` の **min/max の差**(`observedSpanMs` + `durMs`)。`request_index` は完了順・`timestamp` は開始時刻なので配列両端は時刻順にならない。2 件未満は「不明」。
- **provider usage の未取得は「不明」**。`observedTokenTraffic` はサーバで `SUM(...) ?? 0` なので、UI は `requestRows` の per-request 値を null 込みで集計(`usageAgg`)。reported 0 件 → 「不明」、一部 → `(N 件未取得)`、全件 → 数値。値 0 でも reported なら数値(実測ゼロ)。Task 全体・選択 thread の両方。
- **Cache read share** は 3 項目(uncached input / cache_creation / cache_read)すべてを reported した request だけで算出(`cacheReadShare`)。0 件 → 「不明」、全 request に満たなければ `(n/total 件で算出)`。`cache_read` 欠落が 0.0% として通るのを防ぐ。
- フィルタ選択時のみ「UCV/CTV/Amplification は task 全体 / application 固定」を測定条件 note として出す(`(thread=…)` サフィックスは使わない)。

### 3.2 Next focus

**目的**: 最初に見る場所を機械的に指す。原因の断定ではなく候補。

3 枚のカード:

| カード | 値 | 補助 | クリック(ADR-0017) |
|---|---|---|---|
| Thread | 重複文脈バイト合計が最大の thread | `gap の N% を占有` | その thread の thread フィルタを適用 |
| Request | 重複文脈バイト最大の request | `bytes / gap N%` | その request を選択(§3.9 が更新)。thread フィルタ中で対象が別 thread なら、その thread へフィルタを widen してから選択 |
| Breach | running-amp が 5x 到達した request(First 5x) | `この前後の request 順を見る` / 未到達なら「5x 未到達」 | その request を選択(Request と同じ widen。未到達なら無効) |

各カードは `<button class="focus-card">`。値が無いカードは disabled。Next focus は Task 全体の極値を
指すので、フィルタで隠れている対象をクリックしたら「ランキング・request 表・Request detail が食い違う」
のを防ぐためフィルタも合わせる(ADR-0017)。
見出し脇か下に「重複文脈バイト順と running-amp から機械的に選んだ候補(原因の断定ではない)」の 1 行(heuristic である旨)。

### 3.3 request 調査

**目的**: 「まず開く request」を重複文脈バイト順に示し、選ぶ→根拠を読むまでを1つの領域で完結させる
(ADR-0018 — 旧パネル 5「重複の多い request」ランキング・旧パネル 6「タイムライン」・旧パネル 7
「request 表」を統合)。

- **集中度サマリ**(旧 3.5 相当): 一覧の上に「上位 k80 req で重複文脈ボリューム全体の 80% / 上位 k50
  で 50%」(全体基準)。`gap === 0` のときは「重複文脈バイトは 0」とし 80%/50% の要約は出さない。
- **Pareto ストリップ**(旧 3.5 相当): x = rank(重複文脈バイト降順)、y = 累積 gap 占有。k50 / k80 に
  縦線。`<details class="pareto-details">` で折りたたみ、既定は閉(サマリの1行だけを常時表示)。
- **表示切替**(`.tl-seg` セグメントコントロール、既定は「一覧」):
  - **一覧**(旧 3.7「request 表」相当): 既定列は `#` / thread / 重複文脈バイト(バー)/ reuse 比 /
    gap%。「詳細列」トグルで `time` / `m/s` / `model` / `op` / `in` / `out` / `cache_creation` /
    `cache_read` / `app B` / `proto B` / `unk B` / `latency_ms` を追加。既定ソートは重複文脈バイト
    降順(列ヘッダクリックで他列・昇降切替、ephemeral・URL に持たせない)。ページング(§3.3.1)。
    横スクロール(`.scrollx`)。
  - **タイムライン**(旧 3.6「タイムライン」相当): **minimap**(既定)= x 軸 request 順・縦棒の高さ
    = 重複文脈バイト・色 = thread。**thread lanes**(opt-in トグル)= 行 = thread(重複順)、
    ●の面積 = 重複文脈バイト。thread フィルタ選択中は非該当をディム。
  - 切替は同一パネル内の表示モード変更のみで行い、**選択中の request・一覧のページ・ソート順は
    切替をまたいで保持される**(state を握るのが1コンポーネントのため、切替専用の同期コードは
    不要)。
- 対象行は現在フィルタに追従(All = 全 request を `request_index` 昇順、thread = その thread、
  context_class = 全行のまま + `app/proto/unk B` 列で構成確認)。thread フィルタ選択中は「他 N 件
  (<thread> 内)= 残り再送バイトの X%」をフィルタ内基準で表示。
  タイムライン経由で thread フィルタ対象外の request が選ばれた場合は、選択を反映する前にフィルタを
  その request の thread へ切り替える(`all` へは戻さず、対象を表示できる最小のスコープへ変更 —
  Next focus のカードと同じ慣習。常時表示の `Filters` バーが変更後のスコープを示す)。
- **どの操作(一覧の行・タイムラインの点・Next focus のカード)からのクリックでも選択が更新**され、
  §3.4 の Request detail に反映される。

#### 3.3.1 ページング

一覧はクライアント側ページングを持つ(ADR-0018)。

- ページサイズ 20 / 50 / 100 件(既定 20)。Prev/Next + 件数レンジ(「41–60 / 238 件」)+ ページ番号
  を一覧の上下に表示(`.pager`)。純粋関数 `pageSlice` / `pageCount` / `clampPage`
  (`src/ui/client/pagination.ts`)。
- Task・フィルタ・ソート・ページサイズの変更でページを 1 ページ目にリセット。polling による再描画
  (5 秒ごと)ではページ・選択・ソートを変えない。
- 選択中の request が現在ページに含まれない場合(Next focus・タイムライン経由の選択など)は自動的に
  その request を含むページへ遷移する。逆に選択行が別ページにある場合は「選択中の行へ」ボタンで
  手動遷移もできる。

### 3.4 Request detail

**目的**: 選択した 1 request の内訳。ADR-0014 §8 で「将来の selected-request detail」として予約して
いた枠を、診断導線の一部として実装する。§3.3 の `.two-col` で、一覧・タイムラインいずれの表示でも
その隣に置く(中央カラムで**唯一 2 カラムになる行**、`minmax(0,.9fr) minmax(260px,1.1fr)`、900px
未満は 1 カラムに畳む)。ページ全体に張り付く sticky サイドバーには**しない**(スクロール中ずっと
画面に居座って邪魔になるため、ADR-0016)。

- application bytes の **新規(→UCV)| 重複(→CTV−UCV)** split バー。
- Kv: thread / 重複文脈バイト / gap 占有率 / 重複文脈バイト順位(rank / N)/ exact reuse ratio / running amplification / transported(application / protocol / unclassified)。
- 注記(ADR-0017 — 反実仮想を撤回)「この request で観測された重複文脈バイト(既出の Exact Fingerprint と一致した分)は `<bytes>`。request を除外すると一意 context の集合と後続の再利用判定が変わるため、反実仮想の削減量としては読まない。大きさは gap 占有率で見る」。
- 初期状態は「未選択」ではなく、Task を開いた時点で**重複文脈バイト最大の request(diag.topReq)を自動選択**する(abtest-c5.html と同じ — Next focus・request 調査・タイムラインのハイライトが最初から揃う)。selected は component state(polling 再描画・task 切替まで保持)。

### 3.5 推移・閾値プロット

**目的**: running amplification の到達ラインと、5x を超えた地点。

- x = request 順、y = running `CTV / UCV`(`diagnostic.ts` が `requestRows[].applicationBytes` と `exactReuseByRequest[].reusedBytes` から累積再構成。target への rescale なし)。
- 背景帯: `1–2x` / `2–5x` / `5–10x` / `10x 以上`(`ZONE_BANDS` の label、ADR-0017)。破線: 2x / 5x / 10x。
- First 5x に縦マーカー。
- キャプション「running CTV ÷ UCV(近似再計算)/ 帯 = 参照ライン(閾値は heuristic)」。
- context_class が application 以外のときは「対象データなし」(reuse は application のみ)。

### 3.6 重複文脈バイトの内訳

**目的**: 増幅分(`CTV − UCV`)が thread 別にどう分かれるか。あわせて application / protocol / unknown の転送内訳。

- **100% 積み上げバー**: 一意 UCV | thread ごとの重複文脈バイト。凡例に各 thread の bytes。
- キャプション「重複文脈ボリューム `gap` = CTV の `N%`」。
- **thread 分散行**(thread ごと): transported(application/protocol/unknown の内訳バー)+ 重複文脈バイト + gap 占有率。重複順。
- `Claude Code adapter · not Core Measurement` 注記(thread 由来)。
- context_class フィルタ選択時: 選んだ class をハイライト。

### 3.7 Export

ADR-0014 §3.6 の中身のまま(`export.json` / `requests.csv|jsonl` / `threads.csv` / `blocks.csv`、
「この Task 全体」/「現在のフィルタ」の 2 グループ、CSV は RFC 4180 風、生成は `src/ui/export.ts`)。
**パネル番号は持たない**(ADR-0018)。Task 見出し(`task-head`)の隣にネイティブ `<details
class="export"><summary>Export</summary>…</details>` として置き、開閉のみで表示・非表示を切り替える。
一覧内の CSV ショートカット(§3.3 の `ViewExport`)とは役割が異なる — こちらは Task 全体 / フィルタ
スコープの完全な出力用、`ViewExport` は「今見ている調査対象をそのまま出す」ショートカット。

---

## 4. フィルタ(3軸)

ラジオ1つ + 対象セレクタ。複合はしない(v0)。

| フィルタ | 対象 | 影響 |
|---|---|---|
| **All traffic** | — | 絞らない(既定) |
| **thread** | `thread_external_id`(`unknown` 含む)を1つ | Current amplification に「選択 thread」ブロックを追加(Task 全体ブロックは据え置き、ADR-0017)/ 推移プロット / request 調査(一覧・タイムラインとも)を該当 thread に限定。重複文脈バイトの内訳バーは task 全体のまま(block↔thread の対応は v0 測定範囲外)。Pareto k50/k80 は全体基準のまま(ラベルに明示)。**Export**: `export.json` / `requests.*` / `threads.csv` / `blocks.csv` に `?thread=` を付ける。 |
| **context_class** | `application` / `protocol` / `unknown` を1つ | 重複文脈バイトの内訳で強調。推移プロットは application 選択時のみ意味を持つ(他は「対象データなし」)。request 調査の一覧は全行のまま + `app/proto/unk B` 列(詳細列)。Current amplification の UCV/CTV/Amplification は application 固定と注記。**Export**: `blocks.csv?context_class=` に効く。`export.json` は `filter` に記録のみ。 |

フィルタ状態は URL query に持たせる(`?task=...&filter=thread&thread=915`)。共有・リロードで復元できる。
フィルタは表示の絞り込みであると同時に、**request 調査(一覧・タイムライン)・Export のスコープ**でもある(§3.3 / §3.7)。

---

## 5. metrics.ts が UI 向けに提供するもの

Core Measurement の計算式は変えず、`computeTaskMetrics` の戻り値に表示補助データを
2 点足してある。診断レイアウト(§3)はこの 2 点と既存 scalar(`ucv` / `ctv` /
`contextAmplification` / `exactReuseByRequest`)だけで構成でき、**新しい field は要らない**:

1. **thread breakdown の cache 集計**。
   `computeThreadBreakdown` の SELECT に `SUM(cache_creation_input_tokens)`,
   `SUM(cache_read_input_tokens)`, `MIN(request_index)` を含め、
   `ThreadBreakdownRow` に `cacheCreationTokens` / `cacheReadTokens` /
   `firstRequestIndex` を持たせる(§3.4 / §3.9 用)。
2. **per-request の生データ配列**。
   `computeTaskMetrics` が `requestRows`(`RequestRow[]`, `request_index` 昇順)を返す。
   passthrough(`request_index, timestamp, model, operation_type,
   provider_reported_input/output_tokens, cache_creation/read_input_tokens, latency_ms,
   thread_external_id, is_subagent`)に加え、§3.3 request 調査の一覧(詳細列)/ `requests.*` export 用に:
   - `applicationBytes / protocolBytes / unknownBytes` — `structural_blocks` を
     `request_id` で LEFT JOIN し `context_class` 別に `SUM(byte_length)`(`computeRequestRows` 内)。
   - `exactReuseRatio` — `exactReuseByRequest` を `requestIndex` で引いて `computeTaskMetrics` が代入。

診断ロジック側:

- **重複文脈バイト**(§3.3 / §3.4 / §3.6)= `exactReuseByRequest[i].reusedBytes`。
  `Σ ≒ ctv − ucv`(丸め差のみ)。`diagnostic.ts` が加工。
- **running amplification**(§3.5)= 累積 `Σ applicationBytes ÷ Σ (applicationBytes − reusedBytes)` を
  request 順に再構成。target への rescale はしない。「近似」と明示。
- **gap 占有率 / Pareto / zone / Next focus** はすべて上記から `diagnostic.ts` が決定的に計算。

Export の `blocks.csv` は `computeTaskMetrics` を通さず `src/ui/export.ts` が
`structural_blocks ⋈ requests` を直接引く(`TaskMetrics` 型をこれ以上膨らませないため)。

---

## 6. 実装形(v0)

spec §17「core と UI を同一言語・同一データモデル」に沿う。**end user 視点のランタイム依存ゼロ**を維持する
(`vite` / `preact` / `jsdom` はすべて devDependency。UI は `dist/ui/` にバンドル済みとして配布される)。

出荷形態(ADR-0015 移行後):

- クライアントは Preact + Vite でビルドする(`src/ui/client/`、`npm run build` = `vite build`)。
  成果物 `dist/ui/`(`index.html` + hashed `assets/*.js|css`)を `src/ui/server.ts` が配信する。
  `dist/ui/` は版管理しない(`.gitignore` の `dist/` 無視を維持)。
- core / CLI / proxy は従来どおり `.ts` 直接実行でビルド無し。ビルド対象は UI クライアントのみ。
- end user は(将来の)タグ付き GitHub Release tarball を展開し Node で実行するだけ
  (`dist/ui/` 同梱・`npm install` 不要)。source clone した開発者は `npm install` +
  `npm run build`(開発中は `npm run dev:ui` = `vite build --watch`)。詳細は §6.1。

- CLI:
  - `token-profiler ui [--port <n>] [--db <path>]`(既定 port `7331`)
    → `src/cli.ts` の `case 'ui'`、`src/ui/server.ts` を dynamic import。
  - `token-profiler wrap [--no-ui] [--ui-port <n>] -- <cmd>` は proxy 起動と同時に UI を
    `127.0.0.1:7331`(`--ui-port` で上書き可)に立てる(`createUiServer(db, defaultDbPath())`
    — 削除ルート有効)。ポートが埋まっていれば `EADDRINUSE` を握りつぶし、
    既存 UI(同じ既定 DB)の URL だけ表示する = 相乗り。wrap が起動した UI は
    wrap 終了時に閉じる。`--no-ui` で無効化(`--ui-port` との併用はエラー)。
- server: `node:http` のみ。read は `openDbReadOnly()`(`{ readOnly: true }`)。
  WAL のため wrap の writable ハンドルと同一ファイルを同時に読める。
  `createUiServer(db, dbPath?)` — `dbPath` を渡した構成でのみ削除ルートが有効
  (`ui` コマンドと `wrap` 相乗りは渡す。path 無しなら削除は 403)。
  - `GET /`            → `dist/ui/index.html`(Vite ビルドのシェル。`no-store`)
  - `GET /assets/<file>` → `dist/ui/assets/<file>`。`path.basename()` + `fs.realpathSync()` で
    `ASSETS_DIR` 配下に収まることを確認してから読む(`..` / symlink 脱出は 404)。hashed
    filename なので `cache-control: public, max-age=31536000, immutable`。不在も 404。
    `dist/ui/index.html` が無い起動は callers が防ぐ(`uiClientBuilt()` — `wrap` は `--no-ui`
    degrade、`ui` は fail-fast)。
  - `GET /api/tasks`   → `[{ taskId, createdAt, endedAt, requestCount, contextAmplification }]`
  - `GET /api/tasks/:id` → `computeTaskMetrics()` の戻り値(`requestRows` 含む)
  - `GET /api/tasks/:id/export.json`               → `{ generatedAt, filter, filterAppliedTo, note, metrics }`、`?thread=` / `?context_class=` 可
  - `GET /api/tasks/:id/requests.csv|.jsonl`        → request 生行、`?thread=` 可
  - `GET /api/tasks/:id/threads.csv`               → thread breakdown、`?thread=` 可
  - `GET /api/tasks/:id/blocks.csv`                → StructuralBlock 行、`?thread=` / `?context_class=` 可
  - `POST /api/tasks/:id/delete`  body `{ confirmTaskId }` → Task 削除(唯一の write path、
    ADR-0014 / ADR-0016 で存続)。`confirmTaskId` が URL の id と完全一致しなければ 400、実行中(`ended_at
    IS NULL`)は 409、未知の id は 404。成功時 `{ ok, taskId, deletedRequests }`。
    実処理は `deleteTask()`(`src/storage/db.ts`) — child-first(`content_chunks` →
    `structural_blocks` → `requests` → `agents` → `tasks`)の 1 トランザクション、
    短命の `openDbReadWrite()` ハンドル(schema/migrate は再実行しない、busy timeout 5s)。
  - GET の export は `content-disposition: attachment`。既知ルート以外は 404、
    未知メソッドは 405。localhost bind 固定。
- client: `src/ui/client/`(Preact + Vite)。`main.tsx` → `<App>` が診断レイアウト(§3)を描画
  (中央は §3.1・3.2・3.5・3.6 を単一カラムで縦積み、§3.3 request 調査だけ一覧またはタイムラインを
  §3.4 Request detail と `.two-col` グリッドで横並び、`@media (max-width:900px)` で 1 カラムに畳む。
  ADR-0018 で旧パネル 5/6/7 を §3.3 の1パネルへ統合)。
  チャート・バー・タイムライン・Pareto は inline SVG(JSX)、request 調査の一覧 / thread 分散は共有の
  `<DataTable>` コンポーネント。診断ロジックは `diagnostic.ts`(純関数)。CSS は
  `client/styles.css` を `main.tsx` が import → Vite が hashed asset に。外部 CDN 不要。
  view state(`ui` = URL 由来の task/filter/thread/class、`reqSort`、request 調査の `view`
  (list/timeline)・`page`・`pageSize`・`showDetailCols`、timeline の `mode`、`selectedRequest`、
  poll 失敗フラグ `stale`)は `<App>` / 各コンポーネントの component state(ADR-0018)。vdom diffing により polling 再描画で消えないため ordinary state で持つ。
  5 秒 polling(非表示タブで停止)+ ヘッダ Refresh + Task 切替 + 削除後 は、いずれも
  **単一の `load()`**(`<App>`)を通す。世代カウンタで「最新の `load()` だけが `tasks` / `detail` /
  `updatedAt` / `stale` を更新する」— 先に始まった遅い取得が後で完了しても新しい結果を戻さない
  (Task 切替前の応答もヘッダを触らない、ADR-0017)。**自動 poll は取得が in-flight の間はスキップ**
  (`inFlightRef`)— 取得が 5 秒より遅いと世代が毎 tick 進んで全応答が旧世代になり更新が止まるため。
  Refresh / Task 切替 / 削除後は in-flight でも即発火する。`fetchMetrics()` は reject せず
  `MetricsResult.status` を返す: **404** = Task が無い(エラー表示に置換)、**その他の非 2xx / 通信失敗**
  = 一時失敗(前回 `detail` と最終成功時刻を維持し `stale` のみ立てる)。Task 削除は
  `<TaskList>` の `×` → `window.confirm`(full task id + request 数)→ `POST …/delete` →
  `load()`、開いていた Task なら選択解除。per-view Export リンクは現在のフィルタを反映。
  時刻表示 `format.clock()` は `toTimeString()`(閲覧者ローカル、ui-review §4)。
- Export 生成: `src/ui/export.ts`(CSV / JSON Lines シリアライザ + `blocks` 用クエリ + `export.json` の filter metadata)。
- テスト: `test/ui-server.test.ts`(サーバ / API、`node --test`)+ `src/ui/client/**/*.test.tsx`(Vitest + jsdom)。§7。

### 6.1 ADR-0015: UI client build step + release-tarball 配布(A=移行済み / B=未着手)

ADR-0015 は「A: UI を Preact + Vite 化」と「B: タグ付き GitHub Release で `dist/ui/` 同梱
tarball 配布(CI 2 本 + `THIRD_PARTY_NOTICES` 生成)」を対で決めた。**A は実装済み**。**B(`.github/workflows/` の
`check.yml` / `release.yml`、`THIRD_PARTY_NOTICES.txt` 生成、README/INSTALL の 2 導線整備)は未着手** — 別作業。

- **フレームワーク**: Preact + Vite。`view*()` は declarative component 化済み(`src/ui/client/components/`)。
  Preact / Vite は devDependency。
- **ビルド成果物**〔実装済〕: `dist/ui/`(`index.html` + hashed `assets/*.js|css`)。版管理しない。
  `npm run build` = `vite build`(root `src/ui`、`vite.config.ts`)。`npm run check` は
  `typecheck → build → npm test → test:ui`。
- **server アセット配信**〔実装済〕: `UI_DIST` / `INDEX_HTML` / `ASSETS_DIR` を `dist/ui/` 配下に固定。
  許可ルートは「`/` → `dist/ui/index.html`」と「`/assets/<file>`」の 2 つだけ。後者は
  `path.resolve(ASSETS_DIR, path.basename(name))` で組み立て、`fs.realpathSync()` の結果が
  `fs.realpathSync(ASSETS_DIR)` 配下に収まることを確認してから読む。外れ / 不在 / 非ファイルは 404。
  hashed filename は `immutable`、`/api/*` は `no-store`、localhost bind 固定。
- **`dist/ui/` 不在時(source clone で未ビルド)**〔実装済〕: `uiClientBuilt()` が `dist/ui/index.html` の
  有無を返す。`wrap` は warning を出して `--no-ui` へ degrade、`ui` は `UI_NOT_BUILT_MESSAGE` で exit 1。
  release tarball には常に `dist/ui/` があるのでこの経路に入らない。
- **dev ループ**〔実装済〕: `npm run dev:ui`(= `vite build --watch`)+ 既存 `node:http` サーバが
  `dist/ui/` を配信(vite dev server は使わない)。
- **配布**〔未着手 = B〕: タグ push → CI(`npm ci` → `npm run build` → `THIRD_PARTY_NOTICES.txt`
  生成 → tarball → `gh release create`)。tarball 同梱物: `bin/` ・ `src/` ・ `dist/ui/` ・
  `package.json` ・ `package-lock.json` ・ `LICENSE` ・ `THIRD_PARTY_NOTICES` ・ `SECURITY.md` ・
  `README.md` ・ `INSTALL.md`。v0 は GitHub Release のみ。
- **CI**〔未着手 = B〕: `check.yml`(`npm ci && npm run build && npm run check`)+ `release.yml`。
- **テスト**〔実装済〕: `test/ui-server.test.ts` に asset ルートと `startUiServer` の `dist/ui/` 不在 reject。
  旧 `test/ui-client.test.ts`(jsdom で inline `<script>`)は撤去し `src/ui/client/` の Vitest component テストへ置換。

---

## 7. テストの観点

- **`diagnostic.test.ts`**(純関数):
  - 重複文脈バイトの総和が `ctv − ucv` と一致(丸め許容)。
  - gap 占有率の総和 = 1(gap > 0 のとき)。
  - zone 閾値(1-2 / 2-5 / 5-10 / 10x+ の境界)。
  - Pareto: 単調非減少、`k80` は累積 80% 到達の最小件数、空・単一 request の縁ケース。
  - running-amp: request 順で単調に構成、target rescale なし、最終値が `contextAmplification` に近い。
  - Next focus: 最大 thread / 最大 request / First 5x の選択、未到達時の Breach = null。
  - `zoneLabel`: 倍率レンジ表記(`1–2x` / `2–5x` / `5–10x` / `10x 以上`)、境界 2 / 5 / 10。
- **component テスト**(Vitest + jsdom): `<App>` を stub 済み `fetch` 相手に mount し —
  - 5 パネルが描画される(パネル名で確認。パネル順は 1 Current amplification → 2 Next focus →
    3 request 調査 → 4 推移・閾値プロット → 5 重複文脈バイトの内訳。Export はパネル見出しに含まれず、
    `task-head` の `<details class="export">` として別途存在すること、ADR-0018)。
  - Current amplification のゾーン色クラス、判定メトリクス 4 枚、Task 全体 / 選択 thread の 2 グループ Kv。
  - Next focus 3 枚が最大値を指す。カードクリックで該当 thread フィルタ / 該当 request 選択(ADR-0017)。**別 thread に絞った状態で Request / Breach カードを押すと、その request の thread へフィルタが widen し、一覧に選択行が見えること。**
  - Current amplification: 観測スパンが有効 timestamp の min/max(並列順でも壊れない)、usage 未取得 thread は `0 / 0` ではなく「不明」、cache read share は `cache_read` 欠落時に `0.0%` ではなく「不明」(全 request に満たなければ `(n/total 件で算出)`)。
  - request 調査(§3.3、ADR-0018):
    - 一覧: 既定ソート = 重複文脈バイト降順、列ヘッダクリックでソート切替、詳細列トグルで列が増減、
      thread filter で件数注記がフィルタ内基準。集中度サマリと折りたたみ Pareto(既定閉)が一覧の上にあること。
    - ページング: 0 / 1 / pageSize(20) / pageSize+1(21) / 大量件数でページ境界に欠落・重複がないこと。
      フィルタ・ソート・pageSize 変更で 1 ページ目に戻ること。polling 相当の再描画ではページ・選択・
      ソートが変わらないこと。件数減少でページ番号が有効な最終ページへ補正されること。
    - 表示切替: 「一覧⇄タイムライン」ボタンで表示モードが切り替わり、**選択中の request・ページ・
      ソート順が切替をまたいで保持される**こと。
    - タイムライン: minimap ⇄ lanes トグルで描画切替、点クリックで Request detail 更新。thread フィルタ
      外の request を選択すると、フィルタがその request の thread へ切り替わること(`all` への解除では
      ない)。
    - Next focus / タイムライン経由で別ページの request を選択すると、その request を含むページへ
      自動遷移すること。
    - CSV ショートカットが「全 N 件を出力」の対象件数を明示すること(現在ページの件数ではない)。
  - Request detail: §3.3 のどちらの表示モードでも `.two-col` で隣接表示され、ページ全体の sticky
    サイドバーではないこと(ADR-0016)。Task を開いた時点で重複文脈バイト最大の request(diag.topReq)
    が自動選択されていること(未選択プレースホルダではない)、注記に「除くと」が含まれないこと
    (ADR-0017)、選択時の split バーと Kv、polling 再描画・行クリックでの選択保持。
  - ヘッダ: 取得失敗で stale マーカーが出ること。**一時失敗(非 404)では前回 `detail` と `updated` 時刻が変わらないこと。** 遅い応答が新しい結果を上書きしないこと(世代ガード)。**取得が in-flight の間は自動 poll がスキップし、settle 後に再開すること。**
  - `task-head` の Export `<details>`: 開閉トグルで内容(Task 全体 / thread / context_class の3ブロック)
    が表示されること。filter 反映 Export リンク、空・unknown task のプレースホルダ、Task 削除 confirm。
  - `<DataTable>` 単体、`pagination`(`pageSlice` / `pageCount` / `clampPage` の境界)、
    `format`(`durMs`)/ `filter`(`usageAgg` / `observedSpanMs` / `cacheReadShare`)/ `urlState` /
    `diagnostic` のユニット、`clock()` がローカル時刻。
- **`test/ui-server.test.ts`**(`node --test`):
  - 合成 DB で `/api/tasks` / `/api/tasks/:id` が期待値(`requestRows` の class byte / reuse ratio 含む)を返す。
  - Export 各形式・`?thread=` / `?context_class=` のスコープ・`export.json` の `filter` / `filterAppliedTo`・unknown task の 404。
  - `GET /` がビルド済みシェル(`<div id="app">` + hashed js/css 参照)を返す。`/assets/<hashed>` が 200 + `immutable`、
    未知 asset / `%2e%2e%2f` traversal / symlink 脱出 / 非ファイルが 404。`dist/ui/index.html` 不在で `startUiServer` が reject。
  - 配布バンドルの内容: `Current amplification` / `request 調査` / `Next focus` などパネル名を含み、
    **合成スコア・原因断定ラベル・「無駄」「構造的に支配的」・`read-only`・評価語 `Critical` / `Warning` / `Watch` が無い**こと(ADR-0017)、`local data` / `byte basis` を含むこと。
  - `POST …/delete`: 正しい `confirmTaskId` で 200 + 所有行が空。id 不一致 400 / 実行中 409 / 未知 404 / `dbPath` 無しサーバ 403。失敗時は Task が残る。
  - read-only オープンで書き込みが弾かれること・writable ハンドル併存でも読めること。

---

## 8. 未決 / 次フェーズ

- **提案 §3–§5(ADR-0017 の Deferred)**: fingerprint 出現履歴(初出 request / 再出現 request・thread 数。既存 DB で集計 API に載るか・コストが許容かを小さな実例で先に検証)、Task 比較(spec §14.6、Measurement Profile 互換込み)、Task 名前・メモ(新 write path)。着手前チェックは `docs/adr/0017-ui-brings-evidence-adjacent-and-softens-labels.md`。
- **ゾーン閾値の設定**: 2 / 5 / 10x を固定参照ラインにするか、ユーザー設定可にするか(`docs/ui-diagnostic-concept.md` Open Questions)。
- **spec §13 Expert Diagnostics の warning 群**(High context retransmission / Repeated tool output / Review churn suspected / …)と本レイアウトの統合単位。warning を Next focus の入力にするか、別レーンで並置するか。
- **thread lanes のレイアウト**: 狭い幅でのブレイクアウト(詳細探索時は全幅にするか)。
- **Block type breakdown**(ui-review §7): `structural_blocks.type`(system / tool_schema / message / tool_result)別の volume。Protocol が大きいとき system 由来か tool_schema 由来か。重複文脈バイトの内訳パネルに足すか別枠か。
- **data flow diagram**(ui-review §6): request_index 横軸・thread lane・ノード = input bytes・色 = class 構成比。タイムライン lanes の発展形。
- Token Flamegraph・Flow Graph を byte basis のまま先行実装できるか(spec §11–§12)。
- multi-task 比較(spec §14.6)は Measurement Profile 互換チェック込みで別途(ADR-0017 Deferred)。
- server-side conversation state を使う API(Codex Responses 等)では Context Amplification 自体が known limitation(CONTEXT.md)。その Task で診断レイアウトが何を出すか。
