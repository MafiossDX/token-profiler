import type { ComponentChildren } from 'preact';
import type { UiState } from '../urlState.ts';
import type { Diagnostic } from '../diagnostic.ts';
import { ZONE_BANDS, ZONE_COLOR } from '../diagnostic.ts';
import { ratio } from '../format.ts';
import { Section, Note } from './primitives.tsx';
import { docUrl, DOC_ANCHOR } from '../docLinks.ts';

const SEC4_HELP = {
  text: 'running CTV ÷ UCV を request 順に近似再構成した折れ線です（最終値への rescale なし）。背景帯（1–2x/2–5x/5–10x/10x以上）の閾値は参照用の heuristic で、Fact の数値ではありません。',
  href: docUrl(DOC_ANCHOR.sec4),
};

// Same viewBox proportions as abtest-c5.html's threshold plot (900x320) — the
// main chart of the panel, sized to read as the heaviest chart on the page.
const W = 900;
const H = 320;
const L = 52;
const R = 16;
const T = 16;
const B = 34;

// Panel 4 — 推移・閾値プロット (ADR-0016 §3.3; renumbered 3→4 by ADR-0018 to make
// room for the request 調査 panel). Running CTV/UCV per request over the
// reference bands (1–2x / 2–5x / 5–10x / 10x 以上; wording softened by
// ADR-0017). The line is an approximate reconstruction (no rescale to the final
// value) — the caption says so.
export function AmpChart({
  state,
  diag,
}: {
  state: UiState;
  diag: Diagnostic;
}): ComponentChildren {
  if (state.filter === 'context_class' && state.cls !== 'application') {
    return (
      <Section id="view-ampchart" title="4 · 推移・閾値プロット" help={SEC4_HELP}>
        <Note>No running-amp for context_class={state.cls} (application-only).</Note>
      </Section>
    );
  }
  const pts = diag.rows;
  if (pts.length < 2) {
    return (
      <Section id="view-ampchart" title="4 · 推移・閾値プロット" help={SEC4_HELP}>
        <Note>Not enough requests to plot.</Note>
      </Section>
    );
  }

  const maxAmp = Math.max(12, Math.ceil(Math.max(...pts.map((p) => p.runningAmp)) + 1));
  const xs = pts.map((p) => p.requestIndex);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const X = (i: number): number =>
    L + (xmax === xmin ? 0 : ((i - xmin) / (xmax - xmin)) * (W - L - R));
  const Y = (v: number): number => T + (H - T - B) - (Math.min(v, maxAmp) / maxAmp) * (H - T - B);

  const line = pts
    .map((p, k) => (k ? 'L' : 'M') + X(p.requestIndex).toFixed(1) + ' ' + Y(p.runningAmp).toFixed(1))
    .join(' ');
  const last = pts[pts.length - 1];

  return (
    <Section id="view-ampchart" title="4 · 推移・閾値プロット" help={SEC4_HELP}>
      <div class="chart-wrap">
        <svg class="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="running amplification">
          {ZONE_BANDS.map((band) => {
            const top = Y(Math.min(band.to, maxAmp));
            const bot = Y(band.from);
            return (
              <g key={band.zone}>
                <rect
                  x={L}
                  y={top}
                  width={W - L - R}
                  height={Math.max(0, bot - top)}
                  fill={ZONE_COLOR[band.zone]}
                  opacity="0.10"
                />
                <text x={L + 6} y={top + 12}>
                  {band.label}
                </text>
              </g>
            );
          })}
          {[2, 5, 10].map((v) => (
            <g key={v}>
              <line x1={L} y1={Y(v)} x2={W - R} y2={Y(v)} stroke="#8c959f" stroke-dasharray="4 4" />
              <text x="6" y={Y(v) + 3}>
                {v}x
              </text>
            </g>
          ))}
          <path d={line} fill="none" stroke="#1b1f23" stroke-width="2" stroke-linejoin="round" />
          <circle cx={X(last.requestIndex)} cy={Y(last.runningAmp)} r="3.5" fill="#1b1f23" />
          {diag.first5 != null ? (
            <g>
              <line
                x1={X(diag.first5)}
                y1={T}
                x2={X(diag.first5)}
                y2={H - B}
                stroke={ZONE_COLOR.warn}
                stroke-dasharray="3 3"
              />
              <text x={X(diag.first5) + 4} y={T + 10} fill={ZONE_COLOR.warn}>
                #{diag.first5} で 5x
              </text>
            </g>
          ) : null}
          <text x={W / 2} y={H - 4}>
            request_index
          </text>
        </svg>
      </div>
      <p class="note">
        running CTV ÷ UCV（近似再計算・最終値への rescale なし）/ 帯 = 参照ライン（heuristic）。現在値{' '}
        {ratio(last.runningAmp)}。
      </p>
    </Section>
  );
}
