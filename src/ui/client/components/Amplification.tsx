import type { ComponentChildren } from 'preact';
import type { TaskMetrics, RequestRow } from '../api.ts';
import type { UiState } from '../urlState.ts';
import type { Diagnostic } from '../diagnostic.ts';
import { zone, zoneLabel } from '../diagnostic.ts';
import { grp, bytes, pct, ratio, durMs } from '../format.ts';
import {
  filteredRequestRows,
  usageAgg,
  observedSpanMs,
  cacheReadShare,
  type UsageField,
} from '../filter.ts';
import { Section, Kv, Note, Warn } from './primitives.tsx';
import { HelpTip } from './HelpTip.tsx';
import { ViewExport } from './DownloadLink.tsx';
import { docUrl, DOC_ANCHOR } from '../docLinks.ts';

type Agg = { sum: number; have: number; total: number };

// Format a usage aggregate: 不明 when nothing was reported, a "(N 件未取得)"
// suffix when only some rows carried a value, else the plain number. Measured
// zero (have > 0) is never shown as 不明.
function fmtUsage(a: Agg): string {
  if (a.total === 0 || a.have === 0) return '不明';
  return grp(a.sum) + (a.have < a.total ? ` (${a.total - a.have} 件未取得)` : '');
}

const pairUsage = (a: Agg, b: Agg): string => fmtUsage(a) + ' / ' + fmtUsage(b);

// Cache read share, shown only over requests that reported the whole billing
// triple (see filter.cacheReadShare). 不明 when none qualified; a "(n/total 件で
// 算出)" note when the coverage is partial so it can't read as a full aggregate.
function fmtShare(rows: RequestRow[]): string {
  const s = cacheReadShare(rows);
  if (s.share == null) return '不明';
  return pct(s.share) + (s.n < s.total ? ` (${s.n}/${s.total} 件で算出)` : '');
}

const spanLabel = (rows: RequestRow[]): string => {
  const ms = observedSpanMs(rows);
  return ms == null ? '不明' : durMs(ms) || '不明';
};

const IN: UsageField = 'providerReportedInputTokens';
const OUT: UsageField = 'providerReportedOutputTokens';
const CC: UsageField = 'cacheCreationInputTokens';
const CR: UsageField = 'cacheReadInputTokens';

// Panel 1 — Current amplification (ADR-0016 §3.1). The big number + reference
// zone, the judgement-metric row, and the raw Fact scalars. ADR-0017: the zone
// text is a plain ratio range (not "Critical"); Task-level values sit in a
// separate group from the selected-thread values so a thread filter can't make
// the two read as one aggregate; provider usage that was never reported shows
// 不明, not 0.
export function Amplification({
  metrics,
  state,
  diag,
}: {
  metrics: TaskMetrics;
  state: UiState;
  diag: Diagnostic;
}): ComponentChildren {
  const t = metrics.taskId;
  const z = zone(diag.amp);

  const allRows = metrics.requestRows ?? [];
  const gIn = usageAgg(allRows, IN);
  const gOut = usageAgg(allRows, OUT);
  const gCc = usageAgg(allRows, CC);
  const gCr = usageAgg(allRows, CR);

  const threadOn = state.filter === 'thread' && state.thread != null;
  const tr = threadOn ? filteredRequestRows(metrics, state) : [];
  const tIn = usageAgg(tr, IN);
  const tOut = usageAgg(tr, OUT);
  const tCc = usageAgg(tr, CC);
  const tCr = usageAgg(tr, CR);

  const condNote =
    state.filter === 'context_class'
      ? 'UCV / CTV / Amplification is application-only.'
      : threadOn
        ? 'UCV / CTV / Amplification stay task-level (per-thread re-aggregation is out of v0 measurement scope).'
        : '';

  return (
    <Section
      id="view-amp"
      title="1 · Current amplification"
      help={{
        text: 'この Task の Context Amplification（CTV/UCV）と判定に使う指標をまとめたパネルです。値は観測結果で、原因の断定ではありません。',
        href: docUrl(DOC_ANCHOR.sec1),
      }}
    >
      <div class="hero">
        <div class="hero-main">
          <div class="metric-row">
            <div class="metric">
              <div class="metric-head">
                <div class="m-label">Slope</div>
                <HelpTip
                  text="running amplification（累積 CTV÷UCV）が request 1 件進むごとに平均どれだけ変化したかです（(最終値−初期値)÷(request数−1)）。"
                  href={docUrl(DOC_ANCHOR.metricSlope)}
                />
              </div>
              <div class="m-val">{(diag.slope >= 0 ? '+' : '') + diag.slope.toFixed(3)}x</div>
              <div class="m-cap">running-amp / request</div>
            </div>
            <div class="metric">
              <div class="metric-head">
                <div class="m-label">First 5x</div>
                <HelpTip
                  text="running amplification が初めて 5 倍を超えた request の番号です（未到達なら「未到達」）。"
                  href={docUrl(DOC_ANCHOR.metricFirst5)}
                />
              </div>
              <div class="m-val">{diag.first5 == null ? '未到達' : '#' + diag.first5}</div>
              <div class="m-cap">running-amp reaches 5x</div>
            </div>
            <div class="metric">
              <div class="metric-head">
                <div class="m-label">重複文脈バイト</div>
                <HelpTip
                  text="Task 全体で重複と判定された application context の総バイト数です（Σ ≒ CTV − UCV）。"
                  href={docUrl(DOC_ANCHOR.metricDupBytes)}
                />
              </div>
              <div class="m-val">{bytes(diag.gap)}</div>
              <div class="m-cap">Σ ≒ CTV − UCV</div>
            </div>
            <div class="metric">
              <div class="metric-head">
                <div class="m-label">重複最大 req</div>
                <HelpTip
                  text="重複文脈バイトが最大の request の番号です。"
                  href={docUrl(DOC_ANCHOR.metricTopReq)}
                />
              </div>
              <div class="m-val">{diag.topReq ? '#' + diag.topReq.requestIndex : 'n/a'}</div>
              <div class="m-cap">重複文脈バイト最大</div>
            </div>
          </div>

          <p class="sub">Task 全体</p>
          <Kv
            rows={[
              {
                label: 'Task ID',
                value: (
                  <>
                    <span class="mono">{t}</span>
                    <button
                      class="copy"
                      onClick={() => {
                        void navigator.clipboard?.writeText(t);
                      }}
                    >
                      copy
                    </button>
                  </>
                ),
              },
              { label: 'Requests', value: grp(allRows.length) },
              { label: '観測スパン (first→last request)', value: spanLabel(allRows) },
              { label: 'Observed input / output tokens', value: pairUsage(gIn, gOut) },
              { label: 'cache_creation / cache_read', value: pairUsage(gCc, gCr) },
              {
                label: 'Cache read share (billing axis)',
                value: fmtShare(allRows),
                help: {
                  text: 'uncached input・cache_creation・cache_read の 3 項目すべてを報告した request だけで算出した比率です。',
                  href: docUrl(DOC_ANCHOR.metricCacheReadShare),
                },
              },
              {
                label: 'UCV / CTV',
                value: bytes(metrics.ucv) + ' / ' + bytes(metrics.ctv),
                help: {
                  text: 'UCV = 一意な application context バイト数、CTV = 送信された application context バイト数。いずれも Task 全体の合計です。',
                  href: docUrl(DOC_ANCHOR.metricUcvCtv),
                },
              },
              {
                label: 'Classification Coverage',
                value: pct(metrics.classificationCoverage),
                help: {
                  text: '送信バイト全体(application+protocol+unknown の合計)を分母、application と protocol に分類できたバイト数を分子とした割合です(unknown は分母にのみ含みます)。',
                  href: docUrl(DOC_ANCHOR.metricClassCoverage),
                },
              },
            ]}
          />

          {threadOn ? (
            <>
              <p class="sub">選択 thread: {state.thread}</p>
              <Kv
                rows={[
                  { label: 'Requests', value: grp(tr.length) },
                  { label: 'Observed input / output tokens', value: pairUsage(tIn, tOut) },
                  { label: 'cache_creation / cache_read', value: pairUsage(tCc, tCr) },
                  { label: 'Cache read share (billing axis)', value: fmtShare(tr) },
                ]}
              />
            </>
          ) : null}

          {metrics.classificationCoverage != null && metrics.classificationCoverage < 0.95 ? (
            <Warn>Classification Coverage &lt; 95%</Warn>
          ) : null}
          {condNote ? <Note>{condNote}</Note> : null}
        </div>

        <div class={'score zone-' + z}>
          <div class="metric-head">
            <div class="score-label">Current amplification</div>
            <HelpTip
              text="CTV（送信された application context の総量）を UCV（そのうち一意な量）で割った倍率です。帯の色は参照用の目安（heuristic）で、数値自体は観測値です。"
              href={docUrl(DOC_ANCHOR.metricAmp)}
            />
          </div>
          <div class="score-num">{ratio(diag.amp)}</div>
          <div class="score-zone">
            {zoneLabel(diag.amp)} 参照帯 — CTV / UCV は deterministic、帯の閾値は heuristic
          </div>
        </div>
      </div>

      <ViewExport taskId={t} kinds={['export.json']} state={state} />
    </Section>
  );
}
