import type { ComponentChildren } from 'preact';
import type { TaskMetrics } from '../api.ts';
import type { UiState } from '../urlState.ts';
import type { Diagnostic } from '../diagnostic.ts';
import { bytes, pct } from '../format.ts';
import { Section, Note } from './primitives.tsx';
import { ViewExport } from './DownloadLink.tsx';
import { docUrl, DOC_ANCHOR } from '../docLinks.ts';

const SEGS = [
  { css: 'app', name: 'application', label: 'Application' },
  { css: 'proto', name: 'protocol', label: 'Protocol' },
  { css: 'unknown', name: 'unknown', label: 'Unknown' },
] as const;

// Panel 5 — 重複文脈バイトの内訳 (ADR-0016 §3.4; renumbered 4→5 by ADR-0018). The
// amplification gap (CTV − UCV) split into unique UCV + per-thread duplicate
// context bytes, plus the application / protocol / unknown transport
// breakdown (raw Facts) and a per-thread distribution row.
export function ReuseBreakdown({
  metrics,
  state,
  diag,
}: {
  metrics: TaskMetrics;
  state: UiState;
  diag: Diagnostic;
}): ComponentChildren {
  const b = metrics.transportByClass;
  const totalT = metrics.totalTransport || 0;
  const byName: Record<string, number> = {
    application: b.application,
    protocol: b.protocol,
    unknown: b.unknown,
  };
  const ctxFilter = state.filter === 'context_class';
  const ctv = diag.ctv || 1;
  const maxTransported = Math.max(1, ...diag.threads.map((t) => t.transported));

  return (
    <Section
      id="view-reuse"
      title="5 · 重複文脈バイトの内訳"
      help={{
        text: '増幅分（CTV−UCV）を thread 別に分けた内訳と、application/protocol/unknown の転送内訳です。大きさは gap 占有率で見るもので、無駄や削減可能量を意味しません。',
        href: docUrl(DOC_ANCHOR.sec5),
      }}
    >
      <div class="bar">
        <span
          class="seg-ucv"
          style={'width:' + ((diag.ucv / ctv) * 100).toFixed(2) + '%'}
          title={'一意 UCV ' + bytes(diag.ucv)}
        />
        {diag.threads
          .filter((t) => t.dupBytes > 0)
          .map((t) => (
            <span
              key={t.thread}
              style={'width:' + ((t.dupBytes / ctv) * 100).toFixed(2) + '%;background:' + t.color}
              title={t.thread + ' 重複 ' + bytes(t.dupBytes)}
            />
          ))}
      </div>
      <div class="legend">
        <span>
          <i class="seg-ucv" />
          一意 UCV {bytes(diag.ucv)}
        </span>
        {diag.threads
          .filter((t) => t.dupBytes > 0)
          .map((t) => (
            <span key={t.thread}>
              <i style={'background:' + t.color} />
              {t.thread} 重複 {bytes(t.dupBytes)}
            </span>
          ))}
      </div>
      <p class="note">
        重複文脈ボリューム {bytes(diag.gap)} = CTV {bytes(diag.ctv)} の {pct(diag.gap / ctv)}。
      </p>

      <div class="bar" style="margin-top:14px">
        {SEGS.map((s) => {
          const w = totalT ? (byName[s.name] / totalT) * 100 : 0;
          const dim = ctxFilter && state.cls !== s.name;
          return (
            <span
              key={s.css}
              class={'seg-' + s.css + (dim ? ' dim' : '')}
              style={'width:' + w.toFixed(2) + '%'}
            />
          );
        })}
      </div>
      <div class="legend">
        {SEGS.map((s) => (
          <span key={s.css}>
            <i class={'seg-' + s.css} />
            {s.label}
          </span>
        ))}
      </div>
      <table>
        <tbody>
          {SEGS.map((s) => {
            const v = byName[s.name];
            const hl = ctxFilter && state.cls === s.name;
            return (
              <tr key={s.name} style={hl ? 'font-weight:700' : undefined}>
                <td>{s.label}</td>
                <td>{bytes(v)}</td>
                <td>{pct(totalT ? v / totalT : null)}</td>
              </tr>
            );
          })}
          <tr>
            <td>total transport</td>
            <td>{bytes(totalT)}</td>
            <td>100%</td>
          </tr>
        </tbody>
      </table>
      <p class="note">Protocol Share {pct(metrics.protocolShare)}</p>

      <div class="thead-4">
        <span>thread</span>
        <span>transported</span>
        <span class="r">重複文脈バイト</span>
        <span class="r">gap%</span>
      </div>
      {diag.threads.map((t) => (
        <div class="trow-4" key={t.thread}>
          <span class="mono">{t.thread}</span>
          <span class="bar mini" style={'width:' + ((t.transported / maxTransported) * 100).toFixed(1) + '%'}>
            <span class="seg-app" style={'width:' + (t.transported ? (t.appBytes / t.transported) * 100 : 0) + '%'} />
            <span class="seg-proto" style={'width:' + (t.transported ? (t.protoBytes / t.transported) * 100 : 0) + '%'} />
            <span class="seg-unknown" style={'width:' + (t.transported ? (t.unknownBytes / t.transported) * 100 : 0) + '%'} />
          </span>
          <span class="r">{bytes(t.dupBytes)}</span>
          <span class="r">{pct(t.gapShare)}</span>
        </div>
      ))}
      <p class="note">Claude Code adapter · verified_best_effort · not Core Measurement</p>

      {state.filter === 'thread' ? (
        <Note>Task-level: block↔thread mapping is out of v0 measurement scope.</Note>
      ) : null}

      <ViewExport taskId={metrics.taskId} kinds={['blocks.csv']} state={state} />
    </Section>
  );
}
