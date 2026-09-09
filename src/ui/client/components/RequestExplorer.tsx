import type { ComponentChildren } from 'preact';
import { useCallback, useLayoutEffect, useMemo, useState } from 'preact/hooks';
import type { TaskMetrics, RequestRow } from '../api.ts';
import type { UiState } from '../urlState.ts';
import type { Diagnostic } from '../diagnostic.ts';
import { clock, grp, pct } from '../format.ts';
import { filteredRequestRows, threadKeyOfRow } from '../filter.ts';
import { Section, Note } from './primitives.tsx';
import { HelpTip } from './HelpTip.tsx';
import { DataTable, type Column } from './DataTable.tsx';
import { ViewExport } from './DownloadLink.tsx';
import { Timeline } from './Timeline.tsx';
import { RequestDetail } from './RequestDetail.tsx';
import { pageCount, pageSlice, clampPage } from '../pagination.ts';
import { docUrl, DOC_ANCHOR } from '../docLinks.ts';

const SEC3_HELP = {
  text: '重複文脈バイトの多い順に request を並べ、選んだ 1 件の詳細を隣に表示します。一覧とタイムラインは同じ選択・並び順を共有する表示切替です。',
  href: docUrl(DOC_ANCHOR.sec3),
};

export interface ReqSort {
  key: string;
  dir: number;
}

type Row = RequestRow & { dupBytes: number; gapShare: number };
type View = 'list' | 'timeline';

const PAGE_SIZES = [20, 50, 100];

// Pareto strip proportions, unchanged from the panel it absorbs (ADR-0016 §3.5).
const W = 900;
const H = 110;
const L = 40;
const R = 12;
const T = 8;
const B = 18;

// Always-visible columns (ui-review §2: "初期列は request 番号・thread・重複量・
// reuse 比・占有率程度に絞る"). `maxDup` scales the mini bar against the
// Task-wide maximum (not the currently-filtered scope), matching the note
// that occupancy/denominators stay Task-wide (diag.gapShare already does).
// The `#` cell is a <button>, not plain text (code review: the merged list's
// <tr> only responds to onClick — the request/thread filter buttons already
// reach a `<tr>`'s ancestors via Tab, but nothing inside it opens a request's
// detail from the keyboard). stopPropagation keeps the row's own onClick from
// double-firing the same selection.
function compactColumns(
  onSelectThread: (key: string) => void,
  onSelectRequest: (requestIndex: number) => void,
  maxDup: number
): Column<Row>[] {
  return [
    {
      key: 'requestIndex',
      label: '#',
      fmt: (r) => (
        <button
          class="linklike"
          data-req-select={r.requestIndex}
          onClick={(e) => {
            e.stopPropagation();
            onSelectRequest(r.requestIndex);
          }}
        >
          #{r.requestIndex}
        </button>
      ),
    },
    {
      key: 'threadExternalId',
      label: 'thread',
      fmt: (r) => {
        const k = threadKeyOfRow(r);
        return (
          <button
            class="linklike"
            data-thread={k}
            onClick={(e) => {
              e.stopPropagation();
              onSelectThread(k);
            }}
          >
            {k}
          </button>
        );
      },
    },
    {
      key: 'dupBytes',
      label: '重複文脈B',
      fmt: (r) => (
        <>
          {grp(r.dupBytes)}
          <span class="bar mini dup-bar">
            <span
              style={'width:' + ((r.dupBytes / maxDup) * 100).toFixed(1) + '%;background:var(--dup)'}
            />
          </span>
        </>
      ),
    },
    { key: 'exactReuseRatio', label: 'reuse', fmt: (r) => pct(r.exactReuseRatio) },
    { key: 'gapShare', label: 'gap%', fmt: (r) => pct(r.gapShare) },
  ];
}

// 「詳細列」トグルで追加する列(旧 request 表の残り列, ui-review §2)。
function detailColumns(): Column<Row>[] {
  return [
    { key: 'timestamp', label: 'time', fmt: (r) => clock(r.timestamp) },
    {
      key: 'isSubagent',
      label: 'm/s',
      fmt: (r) => (r.isSubagent === true ? 'subagent' : r.isSubagent === false ? 'main' : '–'),
    },
    { key: 'model', label: 'model', fmt: (r) => r.model || '–' },
    { key: 'operationType', label: 'op', fmt: (r) => r.operationType || '–' },
    { key: 'providerReportedInputTokens', label: 'in', fmt: (r) => grp(r.providerReportedInputTokens) },
    {
      key: 'providerReportedOutputTokens',
      label: 'out',
      fmt: (r) => grp(r.providerReportedOutputTokens),
    },
    {
      key: 'cacheCreationInputTokens',
      label: 'cache_creation',
      fmt: (r) => grp(r.cacheCreationInputTokens),
    },
    { key: 'cacheReadInputTokens', label: 'cache_read', fmt: (r) => grp(r.cacheReadInputTokens) },
    { key: 'applicationBytes', label: 'app B', fmt: (r) => grp(r.applicationBytes) },
    { key: 'protocolBytes', label: 'proto B', fmt: (r) => grp(r.protocolBytes) },
    { key: 'unknownBytes', label: 'unk B', fmt: (r) => grp(r.unknownBytes) },
    { key: 'latencyMs', label: 'latency_ms', fmt: (r) => grp(r.latencyMs) },
  ];
}

// フィルタ → 全対象のソート → ページ分割の順(ui-review §1)。同値は
// requestIndex 昇順で安定させ、poll による再描画のたびに同値行が入れ替わって
// 見えないようにする。
function sortRows(rows: Row[], sort: ReqSort): Row[] {
  const dir = sort.dir;
  return rows.slice().sort((a, b) => {
    const x = a[sort.key as keyof Row];
    const y = b[sort.key as keyof Row];
    let cmp: number;
    if (x == null && y == null) cmp = 0;
    else if (x == null) cmp = 1;
    else if (y == null) cmp = -1;
    else cmp = x < y ? -1 : x > y ? 1 : 0;
    if (cmp !== 0) return cmp * dir;
    return a.requestIndex - b.requestIndex;
  });
}

function renderPareto(diag: Diagnostic): ComponentChildren {
  const p = diag.pareto;
  const X = (rank: number): number => L + (W - L - R) * (rank / Math.max(1, p.length));
  const Y = (v: number): number => T + (H - T - B) - v * (H - T - B);
  return (
    <div class="chart-wrap">
      <svg class="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="pareto of duplicate context bytes">
        {[0.5, 0.8, 1].map((v) => (
          <g key={v}>
            <line x1={L} y1={Y(v)} x2={W - R} y2={Y(v)} stroke="#e1e4e8" />
            <text x="4" y={Y(v) + 3}>
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}
        <path
          d={p.map((q, k) => (k ? 'L' : 'M') + X(q.rank).toFixed(1) + ' ' + Y(q.cumShare).toFixed(1)).join(' ')}
          fill="none"
          stroke="#e36209"
          stroke-width="2"
        />
        {[
          [diag.k50, 0.5],
          [diag.k80, 0.8],
        ].map(([k]) => (
          <g key={k}>
            <line x1={X(k)} y1={T} x2={X(k)} y2={H - B} stroke="#8c959f" stroke-dasharray="3 3" />
            <text x={X(k) + 3} y={T + 9}>
              上位 {k}
            </text>
          </g>
        ))}
        <text x={L} y={H - 3}>
          rank → （重複文脈バイト降順の累積 gap 占有）
        </text>
      </svg>
    </div>
  );
}

// Panel 3 — request 調査 (ADR-0018; absorbs the former panels 5「重複の多い
// request」・6「タイムライン」・7「request 表」— ADR-0016 §3.5/§3.6/§3.7,
// ADR-0017 panel order). One list, one selection, one sort, one page: list and
// timeline are display MODES of the same investigation, not separate panels,
// so switching between them keeps the selected request, the list's page, and
// the sort (ui-review §2/§3). Request detail sits adjacent in `.two-col` for
// both modes — never a page-length sticky sidebar (ADR-0016/0017 non-goal,
// reaffirmed by ADR-0018).
export function RequestExplorer({
  metrics,
  state,
  diag,
  sort,
  onSort,
  selected,
  selectSeq,
  onSelectRequest,
  onSelectThread,
}: {
  metrics: TaskMetrics;
  state: UiState;
  diag: Diagnostic;
  sort: ReqSort;
  onSort: (key: string) => void;
  selected: number | null;
  // Bumped by the caller on every explicit selection, including a
  // reselection of the same requestIndex — lets the page-follow effect below
  // react even when `selected`'s value doesn't change (code review: clicking
  // the same Next focus card again must still jump back to its page).
  selectSeq: number;
  onSelectRequest: (requestIndex: number) => void;
  onSelectThread: (key: string) => void;
}): ComponentChildren {
  const [view, setView] = useState<View>('list');
  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState<number>(0);
  const [showDetailCols, setShowDetailCols] = useState<boolean>(false);

  const totalAll = metrics.requestRows?.length ?? 0;

  const dupOf = useMemo(() => new Map(diag.rows.map((r) => [r.requestIndex, r])), [diag]);
  const base = filteredRequestRows(metrics, state);
  const rows: Row[] = base.map((r) => {
    const d = dupOf.get(r.requestIndex);
    return { ...r, dupBytes: d?.dupBytes ?? 0, gapShare: d?.gapShare ?? 0 };
  });
  const sorted = sortRows(rows, sort);
  const maxDupAll = Math.max(1, ...diag.rows.map((r) => r.dupBytes));

  // Task・フィルタ・ソート・表示件数の変更で先頭ページへ戻す。poll 由来の
  // metrics 更新だけでは戻さない(dep に metrics/diag/rows を含めない) —
  // ui-review §1「変更したら先頭ページへ戻す」/「自動更新ではページを先頭に
  // 戻さず」。useLayoutEffect(通常の useEffect ではなく) を使う理由は下の
  // ページ追従 effect のコメントを参照。
  useLayoutEffect(() => {
    setPage(0);
  }, [state.task, state.filter, state.thread, state.cls, sort.key, sort.dir, pageSize]);

  // 外部(Next focus / Timeline / 一覧内の # ボタン)からの選択操作を検知し、
  // 対象行のページへ遷移する。dep は `selected` に加えて `selectSeq` — 同じ
  // request を選び直した(値は変わらない)場合でも `selectSeq` が変わるので
  // 再度ページ遷移が起きる(code review: 「同じ request の再選択では、対象
  // ページへ移動しない」)。`sorted`/`pageSize` は含めない — poll による順位
  // 変化だけでページを動かさないため(ui-review §1)。
  //
  // useEffect ではなく useLayoutEffect: 通常の useEffect は次ペイント後まで
  // 遅延される(Preact は requestAnimationFrame 経由でバッチ実行する)ため、
  // マウント時の自動選択(Detail.tsx の topReq 選択、selected/selectSeq を
  // 更新)がまだこの effect を消化していない間にユーザがページ送りボタンを
  // クリックすると、その後で遅れて発火したこの effect が selected の(変わって
  // いない)ページへ巻き戻してしまう — せっかく分けた「明示的なページ操作」を
  // 上書きする回帰。useLayoutEffect はコミット直後・ペイント前に同期実行される
  // ため、この effect は次のユーザ操作が起こり得るより前に必ず消化される。
  useLayoutEffect(() => {
    if (selected == null) return;
    const idx = sorted.findIndex((r) => r.requestIndex === selected);
    if (idx < 0) return;
    setPage(Math.floor(idx / pageSize));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selectSeq]);

  // タイムラインは diag.rows(フィルタ非依存の全件)を対象にするため、選択が
  // 現在の thread フィルタ外を指すことがある。NextFocus の goToRequest と同じ
  // 慣習で、フィルタをその thread へ広げてから選択する(フィルタを解除せず、
  // 対象を表示できるスコープへ変更する — ui-review §1/§3)。
  const selectFromTimeline = useCallback(
    (requestIndex: number): void => {
      const row = diag.rows.find((r) => r.requestIndex === requestIndex);
      if (row && state.filter === 'thread' && state.thread !== row.thread) {
        onSelectThread(row.thread);
      }
      onSelectRequest(requestIndex);
    },
    [diag, state.filter, state.thread, onSelectThread, onSelectRequest]
  );

  if (totalAll === 0) {
    return (
      <Section id="view-requests" title="3 · request 調査" help={SEC3_HELP}>
        <Note>No requests.</Note>
      </Section>
    );
  }

  const concentrationNote =
    diag.gap === 0
      ? '重複文脈バイトは 0'
      : `上位 ${diag.k80} req で重複文脈ボリューム全体の 80% / 上位 ${diag.k50} で 50%（全体基準）`;

  const pageEff = clampPage(page, sorted.length, pageSize);
  const pages = pageCount(sorted.length, pageSize);
  const shown = pageSlice(sorted, pageEff, pageSize);
  const selIdx = selected == null ? -1 : sorted.findIndex((r) => r.requestIndex === selected);
  const selPage = selIdx < 0 ? null : Math.floor(selIdx / pageSize);

  // A function, not a single JSX const — the toolbar renders this above *and*
  // below the list (ui-review §1 "操作は一覧の上下から行えるようにする"), and
  // Preact requires a fresh vnode per position; reusing one object at two
  // places in the same render corrupts the diff for one of them (a stale
  // Prev/Next pair that never updates after the first click).
  const renderPager = (): ComponentChildren => (
    <div class="pager">
      <button type="button" disabled={pageEff <= 0} onClick={() => setPage(pageEff - 1)}>
        ← 前へ
      </button>
      <span class="sub">
        {sorted.length === 0
          ? '0 件'
          : `${pageEff * pageSize + 1}–${Math.min(sorted.length, (pageEff + 1) * pageSize)} / ${sorted.length} 件`}
        {'　ページ '}
        {pageEff + 1} / {pages}
      </span>
      <button type="button" disabled={pageEff >= pages - 1} onClick={() => setPage(pageEff + 1)}>
        次へ →
      </button>
      {selPage != null && selPage !== pageEff ? (
        <button type="button" class="linklike" onClick={() => setPage(selPage)}>
          選択中の行へ
        </button>
      ) : null}
    </div>
  );

  const cols = showDetailCols
    ? [...compactColumns(onSelectThread, onSelectRequest, maxDupAll), ...detailColumns()]
    : compactColumns(onSelectThread, onSelectRequest, maxDupAll);

  return (
    <Section id="view-requests" title="3 · request 調査" help={SEC3_HELP}>
      <p class="sub">
        重複文脈バイト ＝ app bytes × exact reuse 比 ≒ CTV − UCV への加法寄与。原因の断定ではなく「最初に開く request」の順位。
      </p>
      <p class="note">{concentrationNote}</p>
      {diag.gap > 0 ? (
        <details class="pareto-details">
          <summary>
            集中度グラフ（Pareto）
            <HelpTip
              text="上位何件の request で重複文脈バイト合計の 50%・80% に達するかを、現在のフィルタに関わらず Task 全体基準で示します。"
              href={docUrl(DOC_ANCHOR.metricConcentration)}
            />
          </summary>
          {renderPareto(diag)}
        </details>
      ) : null}

      {state.filter === 'context_class' ? (
        <Note>context_class is a block-level attribute — request rows are not filtered.</Note>
      ) : null}

      {base.length === 0 ? (
        <Note>現在のフィルタでは 0 件（全 {totalAll} 件中）</Note>
      ) : (
        <>
          <div class="toolbar">
            <div class="tl-seg" role="tablist">
              <button
                type="button"
                class={view === 'list' ? 'on' : undefined}
                aria-selected={view === 'list'}
                onClick={() => setView('list')}
              >
                一覧
              </button>
              <button
                type="button"
                class={view === 'timeline' ? 'on' : undefined}
                aria-selected={view === 'timeline'}
                onClick={() => setView('timeline')}
              >
                タイムライン
              </button>
            </div>
            {view === 'list' ? (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={showDetailCols}
                    onChange={(e) => setShowDetailCols((e.target as HTMLInputElement).checked)}
                  />{' '}
                  詳細列
                </label>
                <label>
                  表示件数{' '}
                  <select
                    value={String(pageSize)}
                    onChange={(e) => setPageSize(Number((e.target as HTMLSelectElement).value))}
                  >
                    {PAGE_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n} 件
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
          </div>

          {view === 'list' ? renderPager() : null}

          <div class="two-col">
            {view === 'list' ? (
              <div class="scrollx">
                <DataTable
                  cols={cols}
                  rows={shown}
                  sort={sort}
                  onSort={onSort}
                  rowKey={(r) => r.requestIndex}
                  onRowClick={(r) => onSelectRequest(r.requestIndex)}
                  // `sel` marks only the row driving the Request detail pane. A
                  // thread filter already narrows `rows` to that thread
                  // (filteredRequestRows), so highlighting "matches the thread
                  // filter" here would mark every visible row.
                  rowClass={(r) => 'clickable' + (selected === r.requestIndex ? ' sel' : '')}
                  rowAttrs={(r) => ({ 'data-req': String(r.requestIndex) })}
                />
              </div>
            ) : (
              <Timeline
                state={state}
                diag={diag}
                selected={selected}
                onSelectRequest={selectFromTimeline}
              />
            )}
            <RequestDetail ui={state} diag={diag} selected={selected} onSelectThread={onSelectThread} />
          </div>

          {view === 'list' ? (
            <>
              {renderPager()}
              <ViewExport taskId={metrics.taskId} kinds={['requests.csv', 'requests.jsonl']} state={state} />
            </>
          ) : null}
        </>
      )}
    </Section>
  );
}
