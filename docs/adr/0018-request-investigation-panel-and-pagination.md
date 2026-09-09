---
status: accepted (revises the panel list/order of ADR-0016 §Decision and ADR-0017 §パネル順の改訂)
---

# 観測 UI: 「重複の多い request」と「request 表」を1つの調査パネルへ統合し、ページングと表示切替を足す(ADR-0016 / ADR-0017 の部分改訂)

> ADR-0016・ADR-0017 の一部を本 ADR が改訂する: パネル 5(重複の多い request ランキング)と
> パネル 7(request 表)を「3 · request 調査」に統合、タイムライン(旧パネル 6)をその調査パネル内の
> list⇄timeline 表示切替に変更、Export をパネル番号から外して Task 見出し横の `<details>` に移動、
> パネル順を 1 Amplification → 2 Next focus → 3 request 調査 → 4 推移プロット → 5 内訳 に変更。
> 骨子(診断的な読みを既定にする・原因断定禁止・合成スコア禁止・Request detail を隣接配置しページ
> 全体の sticky にはしない)は不変。

1. `docs/ui-layout-review.md` の UI レビューが、ADR-0017 時点の実装(作業ツリー、未コミット)に対して
   4 点の摩擦を指摘した:
   - **request 表(旧パネル 7)にページングがなく**、request 数が多い Task では一覧が縦に伸び続ける。
   - **パネル 5(重複の多い request ランキング)とパネル 7(request 表)が同じ request を重複量順で
     二度見せる**重複導線になっている。ランキングで候補を選んだあと、根拠を読むには request 表という
     別の一覧を再度スクロールして探す必要がある。
   - **表示順が「候補を知る→選ぶ→根拠を読む」という調査の流れより、集計グラフ(推移・内訳)を先に
     置いている。**
   - **Export が独立した末尾パネル(旧パネル 8)になっており**、閲覧中の Task データへの操作としては
     画面の一番下という遠い場所にある。

2. ADR-0016 は §Decision のパネル列挙で、ADR-0017 はパネル順の改訂([`.two-col`
   をランキング直後・request 表の前に移動]で、それぞれ現在の 8 パネル構成を明示的に決定している。
   ADR-0014 → ADR-0016 → ADR-0017 と同じ「表現・配置の変更は ADR として記録し、戻すにはさらに
   supersede を要求する」意図的な摩擦に倣い、本 ADR として改訂を記録する。measurement
   (`computeTaskMetrics` の計算式・値、`diagnostic.ts` の Pareto/k50/k80/gap が Task 全体基準である
   こと)は一切変えない。新しい API も足さない。

## Decision

`docs/ui-layout-review.md` の指摘のうち、レビュー本文が本命案として示した「ランキングと request 表を
1つの調査パネルへ統合し、タイムラインもその中の表示切替にする」案を全面的に採用する。

### 1. 「重複の多い request」+「request 表」+「タイムライン」を「3 · request 調査」に統合

新コンポーネント `RequestExplorer`(`id="view-requests"`)が、旧 `ReductionCandidates`(パネル 5)・
`Requests`(パネル 7)・`Timeline`(パネル 6、単独パネルとしては廃止)を1つに統合する。

- **一覧(list) / タイムライン(timeline)の表示切替**を `.tl-seg` セグメントコントロールで持つ
  (既定は一覧)。切替は同一コンポーネント内の `view` state の変更のみで行い、**選択中の request・
  一覧のページ・ソート順はすべて保持される**(state を握るのがこの1コンポーネントのため、切替専用の
  同期コードは不要)。ページ全体に追従する sticky 表示にはしない(ADR-0016 の既存方針を継続)。
- **列とソートを1本化**する。旧 `ReductionCandidates` 独自の `<select>` ソートは廃止し、一覧の
  列ヘッダクリックによるソート(`ReqSort` / `onSort`、既定は重複文脈バイト降順)だけを残す — 「同じ
  request を別のソート UI で二度並べ替える」という重複導線をなくす。
- 列は既定で compact(`#` / thread / 重複文脈バイト(ミニバー付き)/ reuse 比 / gap 占有率)。
  「詳細列」トグルで旧 `Requests` の残り列(time / model / op / in / out / cache_creation /
  cache_read / app B / proto B / unk B / latency / m-s)を追加表示する。
- 旧パネル 5 の集中度サマリ(`上位 K 件で重複ボリュームの X%`)は一覧の上に残す。Pareto の SVG は
  `<details class="pareto-details">` で折りたたみ、既定は閉(サマリの一行だけを常時表示し、グラフは
  opt-in にする)。
- Request detail(`RequestDetail`、`id="view-reqdetail"`)は list / timeline のどちらの表示でも
  `.two-col`(既存 CSS、900px 未満で1カラム化)でこの調査パネルに**隣接**する。ADR-0017 が「候補と
  根拠を縦に遠ざけない」として導入した配置を、統合後もそのまま維持する。

### 2. 一覧にクライアント側ページングを追加

- ページサイズは 20 / 50 / 100 件(既定 20)、Prev/Next とページ番号・件数レンジ(`.pager`)を一覧の
  上下に表示する。純粋関数 `pageSlice` / `pageCount` / `clampPage`(`src/ui/client/pagination.ts`)を
  新設し、`pagination.test.ts` で境界(0 / 1 / pageSize / pageSize+1 件)を単体テストする。
- Task・フィルタ・ソート・ページサイズの変更でページを 1 ページ目にリセットする。polling による
  再描画(5 秒ごと)では現在のページ・選択・ソートを変えない。
- 選択中の request が現在ページの表示行に含まれない場合(Next focus・タイムラインからの選択など)は、
  自動的にその request を含むページへ遷移する。

### 3. スコープ外選択での thread フィルタ切替の是正

タイムライン経由で thread フィルタの対象外にある request が選ばれた場合、選択を反映する前に
フィルタをその request の thread へ切り替える(`all` へ戻すのではなく、対象を表示できる最小の
スコープへ変更する — Next focus の goToRequest と同じ慣習)。変更後のスコープは常時表示の
`Filters` バーがそのまま示す — 追加のトースト等は作らない。

（コードレビューでの指摘: 元のレビュー(`docs/ui-layout-review.md` §1/§3)は「フィルタ外なら対象を
表示できるスコープへ変更する」とのみ述べており、`all` への解除とその thread への切替のどちらも
許容する。本 ADR の初版はこれを「`all` へ戻す」と記述していたが、実装(`RequestExplorer.tsx` の
`selectFromTimeline`)は一貫して対象 thread への切替を行っており、一覧件数・Export 対象ともその
thread に絞られる。ここは実装に合わせて記述を訂正した。）

### 4. パネル順の改訂

```
task-head(Task id + Export <details>) → Filters
1 · Current amplification
2 · Next focus
3 · request 調査            ← 統合(旧 5 + 6 + 7)
4 · 推移・閾値プロット        ← 旧 3 を改番
5 · 重複文脈バイトの内訳      ← 旧 4 を改番
```

旧パネル 5(重複の多い request)・6(タイムライン単独)・7(request 表)は 3 に吸収され、独立パネルと
しては存在しなくなる。旧パネル 8(Export)はパネル番号から外れる(次項)。

### 5. Export をパネル番号から外し、Task 見出し横へ移動

`ExportPanel` から `<Section id="view-export" title="8 · Export">` の番号付きラッパーを外し、中身
(Task 全体 / thread / context_class の3ブロック)はそのまま、`task-head`(Task id の見出し)の横に
ネイティブ `<details class="export"><summary>Export</summary>…</details>` として埋め込む。閲覧中の
データへの操作を末尾スクロールなしで開けるようにする(レビュー §4)。一覧側の CSV ショートカット
(`ViewExport`、上記 2)は引き続き各パネル内に残す — Export の `<details>` は Task 全体・フィルタ
スコープの完全な出力用、`ViewExport` は「今見ている調査対象をそのまま出す」ショートカット、という
役割分担は変えない。

## Deferred(今回のスコープ外。レビュー本文が明記する既知の限界を踏襲)

- **API 側ページング・全件集計取得の分離**は行わない。ページングはクライアント側の表示のみで、
  `filteredRequestRows` は引き続き全件を取得してから絞り込む。request 数が非常に多い Task での
  取得・描画性能の計測は今回のスコープ外。
- **狭い画面で選択行の直後に詳細を物理的に挿入する**表現は実装しない。`.two-col` の 900px 未満での
  1カラム折り畳みで近似するに留める(調査領域の直後に Request detail が続く並びにはなるが、選択した
  行の真下に割り込ませる挙動ではない)。
- グラフ描画(Pareto・タイムライン SVG)自体の全件描画性能の測定は行わない。

## ADR-0016 / ADR-0017 との関係

ADR-0016 §Decision のパネル列挙(1〜8)と、ADR-0017 §パネル順の改訂(`.two-col` の位置・パネル 5 の
改称)を本 ADR が改訂する。ADR-0016 / ADR-0017 の本文はいずれも書き換えず、冒頭に本 ADR への参照
一行を追記するに留める(ADR-0014 → ADR-0016 → ADR-0017 と同じ慣習)。引き継ぐもの(本 ADR は緩め
ない):

- 診断的な読みを既定にする骨子(ADR-0016)、Non-Goals(合成 health スコア・原因の断定・profiler が
  検証できない用途名や意味的分類・価値判断の形容・複数点から形を言い当てる散文)。
- 候補と根拠を縦に遠ざけない、かつページ全体の sticky サイドバーにはしない、という配置方針
  (ADR-0017)。
- 参照ゾーンの倍率レンジ表記、Next focus のクリック可能なカード、RequestDetail の反実仮想文言撤回
  (いずれも ADR-0017、本 ADR は変更しない)。
- ローカルデータ管理操作の例外(確認付き Task 削除のみが write path)、Core / Enrichment の視覚的
  分離(ADR-0016 が ADR-0014 から引き継いだもの)。

## Considered Options

- **ランキング(パネル 5)と request 表(パネル 7)を別パネルのまま維持し、ページングだけ request 表に
  足す**: 却下。レビューが指摘した「同じ request を重複量順で二度見せる」重複導線が残る。
- **タイムラインを独立パネルのまま残し、一覧とは別に selected state を持つ**: 却下。切替のたびに
  選択・ソート・ページを同期するコードが別途必要になり、ずれる余地を生む。1コンポーネント内の表示
  切替にすれば同期コード自体が不要になる。
- **Export を廃止せず末尾パネルのまま据え置く**: 却下。レビューが指摘する「操作として遠い」問題が
  残る。一方で Export を一覧の唯一の出力手段にする(パネル自体を削除する)のも却下 — Task 全体 /
  thread / context_class スコープを横断する完全な出力手段は引き続き必要。
- **Request detail をページ全体に追従する sticky サイドバーにする**: 却下。ADR-0016 / ADR-0017 が
  既に「スクロール中ずっと居座って邪魔」として退けた通り。統合後も踏襲しない。

## Consequences

- **`src/ui/client/`**: 新規 `components/RequestExplorer.tsx`(旧 `ReductionCandidates.tsx` +
  `Requests.tsx` を置換・統合。`Timeline` を list⇄timeline トグルとして内包)、新規
  `pagination.ts`(`pageSlice` / `pageCount` / `clampPage`)。`Timeline.tsx` は `<Section>` ラッパーと
  パネル番号を外し、`id="view-timeline"` を保った埋め込み用コンポーネントに変更。`ExportPanel.tsx` は
  `<Section id="view-export">` ラッパーを外し、`Detail.tsx` の `task-head` 内 `<details>` へ移動。
  `AmpChart.tsx`(3→4)・`ReuseBreakdown.tsx`(4→5)のパネル番号を更新。`Detail.tsx` の描画順を
  上記のとおり再編成。`ReductionCandidates.tsx` / `Requests.tsx` は削除。`styles.css` に
  `.task-head` / `.pager` / `.bar.mini.dup-bar` / `details.pareto-details` を追加、`.rank-head` /
  `.rank-row`(旧 `ReductionCandidates` 専用)を削除。
- **`src/ui/server.ts` / `src/core/**` / `src/ui/export.ts`**: 変更なし(新 endpoint・新 measurement
  なし。ページングはクライアント側のみ)。
- **ドキュメント**: `docs/ui-information-design.md`(§2 画面構成・§3 パネル定義の 3.5〜3.8 を統合・
  改番、§7 テスト観点のパネル数/順)、`docs/ui-diagnostic-concept.md`(Position / Screen Structure /
  Reading Order / Interactions のパネル順・番号、用語決定ログへの参照追加)、
  `spec/token-profiler-spec.md`(§14 冒頭のパネル順summary)、`docs/STATUS.md`(パネル列挙・正本
  リンク)、`docs/ui-layout-review.md`(採用済み + 本 ADR へのリンクを追記)、`README.md`(Export の
  導線・「重複の多い request」への言及を更新)、ADR-0016 / ADR-0017(冒頭に本 ADR への参照一行のみ)。
- **テスト**: `src/ui/client/app.test.tsx`(`PANELS` を 5 パネルに更新、Export は `task-head` 内の
  `<details>` として個別アサーション、`#view-candidates` セレクタを `#view-requests
  tr[data-req="…"]` に置換、list⇄timeline 切替後も `#view-reqdetail` が隣接することを確認)、新規
  `src/ui/client/pagination.test.ts`。`test/ui-server.test.ts`(バンドル文字列アサーションを
  `重複の多い request` / `request 表` から `request 調査` に更新)。
- Fact-only や旧パネル構成へ戻すには、本 ADR をさらに supersede する ADR が必要(ADR-0014 →
  ADR-0016 → ADR-0017 と同じ意図的な摩擦)。
