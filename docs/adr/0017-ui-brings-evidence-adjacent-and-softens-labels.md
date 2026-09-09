---
status: accepted (§パネル順の改訂 further revised by ADR-0018)
---

# 観測 UI: 根拠を候補の隣に置き、参照ゾーンの評価語を記述的にする(ADR-0016 の部分改訂)

> ADR-0018 が本 ADR の「パネル順の改訂」をさらに改訂した: パネル 5(重複の多い request)・6
> (タイムライン + Request detail の `.two-col`)・7(request 表)を「3 · request 調査」に統合し、
> Export(旧パネル 8)をパネル番号から外して Task 見出し横の `<details>` に移動(詳細は ADR-0018)。
> 候補と根拠を隣接させる方針・評価語の倍率レンジ表記・Next focus のクリック可能なカード・
> RequestDetail の反実仮想文言撤回は不変。

1. ADR-0016 で `/` の中央ペインを Context Amplification の診断的な読み(参照ゾーン / Next focus /
   重複文脈バイト順ランキング)にした。dogfooding と `docs/ui-improvement-proposal.md`(提案・
   採用/実装未決定)での評価から、次の摩擦が残った:
   - **候補と根拠が縦に遠い**。「重複の多い request」ランキング(パネル 5)で候補を選んでも、
     その根拠(選択 request の詳細)はパネル 6 の request 表を挟んだ下(`.two-col`)にあり、
     選ぶたびに上下にスクロールする。
   - **評価語が誤読を招く**。`Critical` / `Warning` は「倍率が高い = 異常・無駄・削減可能」と
     読ませる。倍率 CTV/UCV は deterministic な観測値で、それ自体は回避可能性を意味しない
     (CONTEXT.md、§4.2 の Fact/Diagnosis 分離)。
   - **反実仮想の文言**。RequestDetail の「この request を除くと CTV − UCV が N 減る」は、
     request を除外すると一意 context の集合と後続の再利用判定が変わるため、観測済みの重複量を
     そのまま削減効果に読み替えている。
   - **集計範囲が混ざる**。thread フィルタ時、Task 全体の UCV/CTV/Amplification と thread 単位の
     token 数が同じ Kv に並び、`(thread=…)` サフィックスだけで区別していた。
   - **取得状態が見えない**。polling が失敗しても前の値が残り、それが最新でない可能性を示さない。

2. ADR-0016 は §3.2 / §3.5 / §3.9 で上記の表現・配置を明示的に採用している。ADR-0014 → ADR-0016 と
   同じ「Fact-only へ戻すには supersede ADR が要る」意図的な摩擦に倣い、これらの改訂を本 ADR として
   記録する。measurement(`computeTaskMetrics` の計算式・値)は一切変えない。新しい API も足さない。

## Decision

`docs/ui-improvement-proposal.md` の**段階1(既存データで可能な範囲)**を採用する。

### パネル順の改訂

`.two-col`(タイムライン + Request detail)を「重複の多い request」ランキングの**直後・request 表の
前**に移す。新しい順:

1. Current amplification
2. Next focus
3. 推移・閾値プロット
4. 重複文脈バイトの内訳
5. **重複の多い request**(旧「削減候補」)
6. **タイムライン + Request detail**(`.two-col`)
7. request 表
8. Export

ADR-0016 §3.6 が置いていた「ランキング直後に生テーブル」という根拠を、「ランキング直後に**根拠**
(選択 request の詳細)」に差し替える(提案「グラフの種類より『候補を選ぶ → 根拠を読む』を優先」)。
Request detail は引き続きタイムラインとペアのインラインパネルで、ページ全体に張り付く sticky
サイドバーにはしない(ADR-0016 の懸念は維持)。

### Next focus のカードをクリック可能にする

3 枚のカードをジャンプ先にする(提案 §1):

- **Thread** → その thread の thread フィルタを適用。
- **Request** → その request を選択(Request detail・ランキング・タイムラインのハイライトが連動)。
- **Breach** → running-amp が 5x に到達した request を選択。未到達なら無効。

「原因の断定ではなく候補」という位置づけは不変(サブタイトルに明示)。

Next focus は **Task 全体の極値**を指す。thread フィルタ選択中に、対象 request が別 thread の場合は
その request が見える所へ **フィルタも切り替える**(その request の thread に widen してから選択)。
でなければランキングと request 表は元の thread のまま = 選択行が表示されず、詳細だけ食い違う。
Breach も同様。

### 参照ゾーンの評価語を倍率レンジ表記に置換

`OK / Watch / Warning / Critical` → **`1–2x` / `2–5x` / `5–10x` / `10x 以上`**。帯の色
(`--z-ok/watch/warn/crit`)は維持する(heuristic band のシグナルはそのまま)。hero の
score ブロックに「CTV / UCV は deterministic、帯の閾値は heuristic」を分離して明示する
(提案 §2 「倍率自体の計測上の性質と、閾値が heuristic であることを分けて示す」)。CSS クラス名
`zone-ok|watch|warn|crit` は内部識別子として保持(利用者可視テキストではない)。

### パネル 5 の改称

「削減候補」→「**重複の多い request**」(提案 §2)。フレーム(＝原因の断定ではなく「最初に開く
request」の優先順位)は不変。「原因」「主犯」は引き続き使わない。

### RequestDetail の反実仮想文言を撤回

「この request を除くと CTV − UCV が N 減る」→「この request で観測された重複文脈バイト
(既出の Exact Fingerprint と一致した分)は N。request を除外すると一意 context の集合と後続の
再利用判定が変わるため、反実仮想の削減量としては読まない。大きさは gap 占有率で見る」
(提案 §2 末尾)。

### Task 全体値と選択 thread 値を表示領域で分離

hero の Kv を 2 グループに分ける(提案 §2 / §5):

- **Task 全体**(常時): Task ID / total requests / 観測スパン / observed input・output /
  cache_creation・read / cache read share / UCV・CTV / Classification Coverage。
- **選択 thread: <id>**(thread フィルタ時のみ、小見出しで区切る): その thread の
  request 数 / observed input・output / cache_creation・read / cache read share。

`(thread=…)` サフィックス方式は廃止。UCV/CTV/Amplification が Task 全体のままである旨の
測定条件 note は維持。

**観測スパン**は `requestRows` の**有効な `timestamp` の最小値と最大値の差**で出す(2 件未満は
「不明」)。`request_index` はレスポンス完了時に採番され `timestamp` は開始時刻なので、並列実行では
配列の両端が時刻順にならず過小/不正になる(`observedSpanMs`、`durMs`)。

**未取得の provider usage は「不明」**。サーバの `observedTokenTraffic` は `SUM(...) ?? 0` で
「全件未取得」と「実測ゼロ」が潰れるため、UI は `requestRows` の per-request 値を null 込みで
集計する(`usageAgg` — reported 件数を保持)。reported が 0 件なら「不明」、一部なら `(N 件未取得)`
を添える、全件なら数値。値が 0 でも reported なら数値(実測ゼロ)。Task 全体・選択 thread の両方に適用。

**Cache read share**(= `cache_read / (uncached input + cache_creation + cache_read)`、billing 軸)は
**3 項目すべてを reported した request だけ**で算出する(`cacheReadShare` in `filter.ts`)。1 項目でも
欠けた request は分母・分子から除く — でないと `cache_read` 欠落が 0.0% として通る。算出対象が
0 件なら「不明」、全 request に満たなければ `(n/total 件で算出)` を添える。

### 取得状態の明示

ヘッダに、最終取得成功時刻(既存)に加え、直近の取得が失敗したときは
「取得失敗・表示は最新でない可能性」マーカーを出す(提案 §5)。前の値・最終成功時刻は維持する。

- **取得は単一経路 `load()` に統一**(poll / Refresh / Task 切替 / 削除後 いずれも)。世代カウンタで
  「最新の `load()` だけが共有 state(`tasks` / `detail` / `updatedAt` / `stale`)を触れる」ようにし、
  先に始まった遅い取得が後から完了しても新しい結果を上書きしない。Task 切替前の応答もヘッダを更新しない。
- **自動 poll は in-flight 中はスキップ**(`inFlightRef`)。取得が `POLL_MS`(5s)より遅いと、毎 tick で
  世代が進み全応答が旧世代になって何も更新されなくなる — これを避ける。Refresh / Task 切替 / 削除後は
  in-flight でも即発火する(旧応答の無効化は世代ガードが担う)。
- **`fetchMetrics()` は reject しない**(`MetricsResult.status` を持つ)。通信失敗は `status: 0`。
  **404** は「Task が無い」= エラー表示に置換。**それ以外の非 2xx / 通信失敗**は一時失敗として扱い、
  前回の `detail` と最終成功時刻を維持したまま `stale` を立てるだけ。旧 `app.tsx:81` の catch 抜け
  (未処理 Promise 拒否)も、この単一経路で解消。

## Deferred(将来。着手前チェックを明記)

提案の段階2・段階3 は本 ADR では実装しない。着手前に次を満たすこと:

- **fingerprint 出現履歴(提案 §3)**: 既存 DB での集計コストの検証が先。
- **Task 比較(提案 §4、spec §14.6)**: Measurement Profile 互換チェックの設計が先。
- **Task 名前・メモ(提案 §5)**: 新しい write path。現行のローカルデータ管理方針との整合が先。

## ADR-0016 との関係

ADR-0016 の §3.2 / §3.5 / §3.6 / §3.7 / §3.9 の**表現と配置**を本 ADR が改訂する。ADR-0016 の
frontmatter に「§3.2/§3.5/§3.6/§3.7/§3.9 amended by ADR-0017」を付す。引き継ぐもの(本 ADR は
緩めない):

- Fact-only を緩めた §3 の骨子(診断的な読みを既定にする)。
- Non-Goals — 合成 health スコア、原因の断定、profiler が検証できない用途名・意味的分類、
  価値判断の形容、複数点から形を言い当てる散文。
- ローカルデータ管理操作の例外(確認付き Task 削除だけが write path)。
- Core と Enrichment の視覚的分離(thread 由来の表示に `Claude Code adapter · not Core Measurement`)。

## Considered Options

- **ADR-0016 を直接編集して別 ADR を起こさない**: 却下。ADR-0014 → ADR-0016 で確立した「表現方針の
  変更は ADR として記録し、戻すにはさらに supersede を要求する」摩擦に反する。
- **段階2 / 段階3 も今実装する**: 却下。提案自身が実装前の DB スキーマ・取得コスト検証を求めており、
  既存データで実現できるか未確認。
- **評価語を残したまま注記だけ足す**: 却下。`Critical` の語そのものが判定を含意する。注記より語の
  置換が確実(提案 §2)。
- **Request detail をページ全体の sticky サイドバーにして常時見えるようにする**: 却下。ADR-0016 が
  「スクロール中ずっと居座って邪魔」として退けた通り。ランキング直後への移動で十分。

## Consequences

- **`src/ui/client/`**: `diagnostic.ts`(`zoneName` → `zoneLabel` = 倍率レンジ、`ZONE_BANDS` の
  label)、`format.ts`(`durMs`)、`filter.ts`(`usageAgg` / `observedSpanMs` / `cacheReadShare`)、
  `api.ts`(`MetricsResult.status`、`fetchMetrics` は reject しない)、`NextFocus`(props に `state` /
  `onSelectThread` / `onSelectRequest`、カードを `<button>`、フィルタ外なら widen)、
  `ReductionCandidates`(パネル名)、`RequestDetail`(注記文言)、`Amplification`(2 グループ Kv、
  `zoneLabel`、観測スパン、usage 不明表示、cache read share の部分カバレッジ注記)、
  `Detail`(パネル順・NextFocus 配線)、`Timeline` / `Requests`(パネル番号)、`app.tsx`
  (世代ガード付き単一 `load()`、in-flight 中の自動 poll スキップ、404 と一時失敗の区別)+
  `Header`(`stale` マーカー)、`styles.css`(`.focus-card` の button reset、`.warn-badge`)。
  `diagnostic.ts` の数値ロジック(zone 閾値・Pareto・running-amp・Next focus 選択)は不変。
- **`src/ui/server.ts` / `src/core/**` / `src/ui/export.ts`**: 変更なし(新 endpoint・新 measurement なし)。
- **ドキュメント**: `docs/ui-information-design.md`(§1 表現ルール / §2 画面構成 / §3.1・3.2・3.5・
  3.6・3.7・3.9 / §7 テスト観点 / §8 未決)、`docs/ui-diagnostic-concept.md`(用語決定ログ:
  「削減候補」「OK/Watch/Warning/Critical」の行を「採用(改訂)」に、RequestDetail の
  leave-one-out 風文言撤回の行を追加)、`spec/token-profiler-spec.md`(§14 冒頭のパネル順、
  §14.6 を将来機能と明示、§19.4 に fingerprint 出現履歴を追記)、新規 `docs/STATUS.md`
  (現状ページ)、`README.md`(観測の読み方の例)。
- **テスト**: `src/ui/client/diagnostic.test.ts`(`zoneLabel`)、`src/ui/client/format.test.ts`
  (`durMs`)、新規 `src/ui/client/filter.test.ts`(`usageAgg` の 不明/一部/全件、`observedSpanMs` が
  min/max・並列順・2 件未満で null、`cacheReadShare` が三項目揃った request のみ・部分カバレッジ・
  0 件で null)、`src/ui/client/app.test.tsx`(パネル名・順序、Next focus クリック + フィルタ外 widen、
  RequestDetail 注記、一時失敗で前回表示・最終成功時刻を維持 + stale、usage 未取得 thread の「不明」、
  cache read share が 0.0% でなく「不明」、in-flight 中は自動 poll がスキップし settle 後に再開)、
  `test/ui-server.test.ts`(バンドル文字列: `重複の多い request` を
  含み、`Critical` / `Warning` / `Watch` を含まない)。
- Fact-only へ戻す、または本 ADR の表現方針を覆すには、さらに supersede する ADR が必要。
