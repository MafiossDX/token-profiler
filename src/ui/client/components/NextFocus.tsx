import type { ComponentChildren } from 'preact';
import type { UiState } from '../urlState.ts';
import type { Diagnostic, DupRow } from '../diagnostic.ts';
import { bytes, pct } from '../format.ts';
import { Section } from './primitives.tsx';
import { docUrl, DOC_ANCHOR } from '../docLinks.ts';

// Panel 2 — Next focus (ADR-0016 §3.2). Mechanically picked candidates from the
// duplicate-context ranking and the running-amp curve. Candidates, not a cause
// claim — the subtitle says so. Each card is a jump target (ADR-0017): Thread
// applies the thread filter, Request / Breach select that request. Next focus
// points at task-wide extremes, so if a thread filter is hiding the target we
// widen the filter to that request's thread first — otherwise the ranking and
// request 表 would keep showing a different thread and the selected row would
// not be visible.
export function NextFocus({
  state,
  diag,
  onSelectThread,
  onSelectRequest,
}: {
  state: UiState;
  diag: Diagnostic;
  onSelectThread: (key: string) => void;
  onSelectRequest: (requestIndex: number) => void;
}): ComponentChildren {
  const sub = '重複文脈バイト順と running-amp から機械的に選んだ候補（原因の断定ではない）';
  const topThread = diag.topThread;
  const topReq = diag.topReq;
  const breachReq =
    diag.first5 == null ? undefined : diag.rows.find((r) => r.requestIndex === diag.first5);

  const goToRequest = (r: DupRow | undefined): void => {
    if (!r) return;
    if (state.filter === 'thread' && state.thread !== r.thread) onSelectThread(r.thread);
    onSelectRequest(r.requestIndex);
  };

  return (
    <Section
      id="view-nextfocus"
      title="2 · Next focus"
      subtitle={sub}
      help={{
        text: '3 枚のカードは、重複合計が最大の thread / 重複文脈バイトが最大の request / running amplification が初めて 5 倍を超えた request、をそれぞれ指します。',
        href: docUrl(DOC_ANCHOR.sec2),
      }}
    >
      <div class="nextfocus">
        <button
          type="button"
          class="focus-card"
          disabled={!topThread}
          onClick={() => topThread && onSelectThread(topThread.thread)}
        >
          <div class="m-label">Thread</div>
          <div class="m-val">{topThread ? topThread.thread : 'n/a'}</div>
          <div class="m-cap">
            {topThread ? 'gap の ' + pct(topThread.gapShare) + ' を占有' : 'thread 情報なし'}
          </div>
        </button>
        <button
          type="button"
          class="focus-card"
          disabled={!topReq}
          onClick={() => goToRequest(topReq ?? undefined)}
        >
          <div class="m-label">Request</div>
          <div class="m-val">{topReq ? '#' + topReq.requestIndex : 'n/a'}</div>
          <div class="m-cap">
            {topReq ? bytes(topReq.dupBytes) + ' / gap ' + pct(topReq.gapShare) : 'request 情報なし'}
          </div>
        </button>
        <button
          type="button"
          class="focus-card"
          disabled={!breachReq}
          onClick={() => goToRequest(breachReq)}
        >
          <div class="m-label">Breach</div>
          <div class="m-val">{diag.first5 == null ? '5x 未到達' : '#' + diag.first5}</div>
          <div class="m-cap">
            {diag.first5 == null ? '5x 未到達' : 'この前後の request 順を見る'}
          </div>
        </button>
      </div>
    </Section>
  );
}
