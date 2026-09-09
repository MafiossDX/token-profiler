import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useMemo } from 'preact/hooks';
import type { MetricsResult } from '../api.ts';
import type { UiState, FilterMode } from '../urlState.ts';
import { derive } from '../diagnostic.ts';
import { Filters } from './Filters.tsx';
import { Amplification } from './Amplification.tsx';
import { NextFocus } from './NextFocus.tsx';
import { AmpChart } from './AmpChart.tsx';
import { ReuseBreakdown } from './ReuseBreakdown.tsx';
import { RequestExplorer, type ReqSort } from './RequestExplorer.tsx';
import { ExportPanel } from './ExportPanel.tsx';

// The detail pane: task-head (Export) + filter bar + the diagnostic panels,
// stacked single-column (ADR-0016 §3). Panel order (ADR-0018, revising
// ADR-0017): 1 amplification · 2 Next focus · 3 request 調査 (list⇄timeline +
// Request detail, absorbing the former 5 重複の多い request / 6 タイムライン /
// 7 request 表) · 4 推移プロット · 5 内訳. Export is no longer a numbered bottom
// panel — it sits next to the Task heading as a `<details>` (ADR-0018 §4).
export function Detail({
  ui,
  detail,
  loading,
  reqSort,
  onSort,
  onMode,
  onThread,
  onContextClass,
  selectedRequest,
  selectSeq,
  onSelectRequest,
}: {
  ui: UiState;
  detail: MetricsResult | null;
  loading: boolean;
  reqSort: ReqSort;
  onSort: (key: string) => void;
  onMode: (mode: FilterMode) => void;
  onThread: (key: string) => void;
  onContextClass: (cls: string) => void;
  selectedRequest: number | null;
  selectSeq: number;
  onSelectRequest: (requestIndex: number | null) => void;
}): ComponentChildren {
  const metrics = detail?.ok ? detail.metrics : null;
  const diag = useMemo(() => (metrics ? derive(metrics) : null), [metrics]);

  // Open on the top reduction candidate, same as abtest-c5.html (§3.9) — Next
  // focus and every panel's highlight agree from first paint instead of
  // waiting for a click. Only fires while nothing is selected yet; <App>
  // resets selectedRequest to null on task switch.
  //
  // useLayoutEffect, not useEffect: a plain useEffect is deferred until after
  // paint (Preact batches it via requestAnimationFrame), so an explicit
  // selection made in between — e.g. clicking a request row's `#` button the
  // instant it renders — can be silently overwritten when this stale-closure
  // effect (still holding `selectedRequest == null` from the pre-selection
  // render) finally runs and re-applies the auto-selected topReq. A layout
  // effect commits synchronously, before any further user interaction is
  // possible, so it never lands after a real selection.
  useLayoutEffect(() => {
    if (diag && selectedRequest == null && diag.topReq) {
      onSelectRequest(diag.topReq.requestIndex);
    }
  }, [diag, selectedRequest, onSelectRequest]);

  if (!ui.task) {
    return <div class="empty">Select a task from the left.</div>;
  }
  if (detail == null) {
    return <div class="empty">{loading ? 'Loading…' : 'Select a task from the left.'}</div>;
  }
  if (!detail.ok || !metrics || !diag) {
    return <div class="empty">{detail.error ?? 'not found'}</div>;
  }

  return (
    <>
      <div class="task-head">
        <h2 class="mono">{metrics.taskId}</h2>
        <details class="export">
          <summary>Export</summary>
          <ExportPanel metrics={metrics} state={ui} />
        </details>
      </div>
      <Filters
        metrics={metrics}
        state={ui}
        onMode={onMode}
        onThread={onThread}
        onContextClass={onContextClass}
      />
      <Amplification metrics={metrics} state={ui} diag={diag} />
      <NextFocus
        state={ui}
        diag={diag}
        onSelectThread={onThread}
        onSelectRequest={onSelectRequest}
      />
      <RequestExplorer
        metrics={metrics}
        state={ui}
        diag={diag}
        sort={reqSort}
        onSort={onSort}
        selected={selectedRequest}
        selectSeq={selectSeq}
        onSelectRequest={onSelectRequest}
        onSelectThread={onThread}
      />
      <AmpChart state={ui} diag={diag} />
      <ReuseBreakdown metrics={metrics} state={ui} diag={diag} />
    </>
  );
}
