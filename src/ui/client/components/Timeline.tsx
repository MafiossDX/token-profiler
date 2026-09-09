import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { UiState } from '../urlState.ts';
import type { Diagnostic } from '../diagnostic.ts';
import { Note } from './primitives.tsx';

type Mode = 'minimap' | 'lanes';

// One of the two display modes of panel 3「request 調査」(ADR-0016 §3.7;
// absorbed from its own panel 6 by ADR-0018 as a list⇄timeline toggle inside
// the merged investigation area — `id="view-timeline"` kept on the inner div
// so existing selectors still resolve). "When / in which thread did the
// duplicate bytes pile up." minimap (default) collapses hundreds of requests
// to one strip; thread lanes (opt-in) spreads them by thread. Height / dot
// area = duplicate context bytes. Mode is ephemeral component state. Paired
// with Request detail in a `.two-col` row — not a page-length sticky sidebar.
export function Timeline({
  state,
  diag,
  selected,
  onSelectRequest,
}: {
  state: UiState;
  diag: Diagnostic;
  selected: number | null;
  onSelectRequest: (requestIndex: number) => void;
}): ComponentChildren {
  const [mode, setMode] = useState<Mode>('minimap');
  const rows = diag.rows;
  if (!rows.length) {
    return (
      <div id="view-timeline">
        <Note>No requests.</Note>
      </div>
    );
  }

  const active = state.filter === 'thread' ? state.thread : null;
  const maxDup = Math.max(1, ...rows.map((r) => r.dupBytes));
  const xs = rows.map((r) => r.requestIndex);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);

  const seg = (
    <div class="tl-seg" role="tablist">
      <button
        type="button"
        class={mode === 'minimap' ? 'on' : undefined}
        aria-selected={mode === 'minimap'}
        onClick={() => setMode('minimap')}
      >
        minimap
      </button>
      <button
        type="button"
        class={mode === 'lanes' ? 'on' : undefined}
        aria-selected={mode === 'lanes'}
        onClick={() => setMode('lanes')}
      >
        thread lanes
      </button>
    </div>
  );

  return (
    <div id="view-timeline">
      {seg}
      {mode === 'minimap'
        ? renderMinimap(rows, { xmin, xmax, maxDup, active, selected, diag, onSelectRequest })
        : renderLanes(diag, { xmin, xmax, maxDup, active, selected, onSelectRequest })}
      <p class="note">
        {mode === 'minimap'
          ? '縦 = 重複文脈バイト / 色 = thread。数百 request を 1 本に。クリックで詳細。'
          : '行 = thread（重複順）/ ●の面積 = 重複文脈バイト / 横 = request 順。クリックで詳細。'}
      </p>
    </div>
  );
}

interface Ctx {
  xmin: number;
  xmax: number;
  maxDup: number;
  active: string | null;
  selected: number | null;
  onSelectRequest: (requestIndex: number) => void;
}

function renderMinimap(
  rows: Diagnostic['rows'],
  ctx: Ctx & { diag: Diagnostic }
): ComponentChildren {
  // Same viewBox proportions as abtest-c5.html's minimap (1000x140).
  const W = 1000;
  const H = 140;
  const L = 34;
  const R = 10;
  const T = 12;
  const base = H - 22;
  const { xmin, xmax, maxDup, active, selected, diag, onSelectRequest } = ctx;
  const X = (i: number): number => L + (xmax === xmin ? 0 : ((i - xmin) / (xmax - xmin)) * (W - L - R));
  const bw = Math.max(1, (W - L - R) / rows.length - 0.5);

  return (
    <div class="chart-wrap">
      <svg class="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="duplicate context minimap">
        <line x1={L} y1={base} x2={W - R} y2={base} stroke="#e1e4e8" />
        {rows.map((r) => {
          const h = (r.dupBytes / maxDup) * (base - T);
          const dim = active != null && active !== r.thread;
          const isSel = selected === r.requestIndex;
          return (
            <rect
              key={r.requestIndex}
              x={X(r.requestIndex)}
              y={base - h}
              width={bw}
              height={h}
              fill={diag.colorOfThread(r.thread)}
              opacity={isSel ? 1 : dim ? 0.25 : 0.82}
              stroke={isSel ? '#1b1f23' : 'none'}
            />
          );
        })}
        {rows.map((r) => (
          <rect
            key={'h' + r.requestIndex}
            class="hit"
            x={X(r.requestIndex) - bw / 2 - 1}
            y={T}
            width={bw + 2}
            height={base - T}
            data-req={r.requestIndex}
            onClick={() => onSelectRequest(r.requestIndex)}
          />
        ))}
      </svg>
    </div>
  );
}

function renderLanes(diag: Diagnostic, ctx: Ctx): ComponentChildren {
  const W = 1000;
  const L = 96;
  const R = 12;
  const T = 20;
  const laneH = 46;
  const { xmin, xmax, maxDup, active, selected, onSelectRequest } = ctx;
  const ids = diag.threads.map((t) => t.thread);
  const H = T + ids.length * laneH + 10;
  const X = (i: number): number => L + (xmax === xmin ? 0 : ((i - xmin) / (xmax - xmin)) * (W - L - R));

  return (
    <div class="chart-wrap">
      <svg class="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="duplicate context lanes">
        {ids.map((id, ti) => {
          const y0 = T + ti * laneH + laneH / 2;
          const dim = active != null && active !== id;
          const laneRows = diag.rows.filter((r) => r.thread === id);
          return (
            <g key={id}>
              <text x="6" y={y0 + 3} fill={dim ? '#aab2bd' : '#3c4a58'}>
                {id}
              </text>
              <line x1={L} y1={y0} x2={W - R} y2={y0} stroke="#e1e4e8" />
              {laneRows.map((r) => {
                const rr = 1.6 + 11 * Math.sqrt(r.dupBytes / maxDup);
                const isSel = selected === r.requestIndex;
                return (
                  <circle
                    key={r.requestIndex}
                    cx={X(r.requestIndex)}
                    cy={y0}
                    r={rr}
                    fill={diag.colorOfThread(id)}
                    opacity={dim ? 0.18 : 0.8}
                    stroke={isSel ? '#1b1f23' : '#fff'}
                    stroke-width={isSel ? 2 : 0.6}
                  />
                );
              })}
              {laneRows.map((r) => {
                const rr = Math.max(5, 1.6 + 11 * Math.sqrt(r.dupBytes / maxDup));
                return (
                  <rect
                    key={'h' + r.requestIndex}
                    class="hit"
                    x={X(r.requestIndex) - rr}
                    y={y0 - laneH / 2}
                    width={rr * 2}
                    height={laneH}
                    data-req={r.requestIndex}
                    onClick={() => onSelectRequest(r.requestIndex)}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
