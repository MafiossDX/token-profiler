import type { ComponentChildren } from 'preact';
import type { UiState } from '../urlState.ts';
import type { Diagnostic } from '../diagnostic.ts';
import { bytes, pct } from '../format.ts';
import { Section, Kv, Note } from './primitives.tsx';
import { docUrl, DOC_ANCHOR } from '../docLinks.ts';

// Request detail (ADR-0016 §3.9), paired next to the Timeline panel in a
// `.two-col` row (abtest-c5.html) rather than a page-length sticky sidebar.
// The selected-request breakdown that ADR-0014 §8 reserved; now built as part
// of the diagnostic flow. Shows the new (→UCV) | duplicate (→CTV−UCV) split of
// application bytes, plus raw per-request Facts. Any panel (重複の多い request
// ranking, タイムライン, request 表) can change the selection — Selection is
// component state in <App> (survives polling).
export function RequestDetail({
  diag,
  selected,
  onSelectThread,
}: {
  ui: UiState;
  diag: Diagnostic;
  selected: number | null;
  onSelectThread: (key: string) => void;
}): ComponentChildren {
  const r = selected == null ? null : diag.rows.find((x) => x.requestIndex === selected) ?? null;
  if (!r) {
    return (
      <Section id="view-reqdetail" title="Request detail">
        <Note>重複の多い request・タイムライン・request 表から request を選択。</Note>
      </Section>
    );
  }
  const rank = diag.ranked.findIndex((x) => x.requestIndex === r.requestIndex) + 1;
  const newPct = r.appBytes ? (r.uniqueBytes / r.appBytes) * 100 : 0;
  const dupPct = r.appBytes ? (r.dupBytes / r.appBytes) * 100 : 0;

  return (
    <Section id="view-reqdetail" title={`Request #${r.requestIndex}`}>
      <div class="split">
        <span class="new" style={'width:' + newPct.toFixed(1) + '%'}>
          new {bytes(r.uniqueBytes)}
        </span>
        <span class="dup" style={'width:' + dupPct.toFixed(1) + '%'}>
          重複 {bytes(r.dupBytes)}
        </span>
      </div>
      <p class="note">application bytes を「新規（→UCV）」と「重複（→CTV−UCV）」に分けたもの。</p>

      <Kv
        rows={[
          {
            label: 'thread',
            value: (
              <button class="linklike" onClick={() => onSelectThread(r.thread)}>
                {r.thread}
              </button>
            ),
          },
          {
            label: '重複文脈バイト',
            value: bytes(r.dupBytes),
            help: {
              text: 'この request の application bytes のうち、既出の Exact Fingerprint と一致した（重複と判定された）バイト数です。',
              href: docUrl(DOC_ANCHOR.reqDetailDupBytes),
            },
          },
          {
            label: 'gap 占有率',
            value: pct(r.gapShare),
            help: {
              text: 'この request の重複文脈バイトが、Task 全体の重複文脈バイト合計（gap）に占める割合です。',
              href: docUrl(DOC_ANCHOR.reqDetailGapShare),
            },
          },
          {
            label: '重複文脈バイト順位',
            value: rank + ' / ' + diag.rows.length,
            help: {
              text: '重複文脈バイトの降順で並べたときのこの request の順位です。',
              href: docUrl(DOC_ANCHOR.reqDetailRank),
            },
          },
          {
            label: 'exact reuse ratio',
            value: pct(r.reuse),
            help: {
              text: 'この request の application bytes のうち重複と判定された割合です（dupBytes ÷ appBytes）。',
              href: docUrl(DOC_ANCHOR.reqDetailReuseRatio),
            },
          },
          {
            label: 'running amplification',
            value: r.runningAmp.toFixed(2) + 'x',
            help: {
              text: 'この request までの累積 CTV ÷ 累積 UCV です（近似再計算、最終値への rescale なし）。',
              href: docUrl(DOC_ANCHOR.reqDetailRunningAmp),
            },
          },
          { label: 'transported', value: bytes(r.transported) },
          { label: '  application', value: bytes(r.appBytes) },
          { label: '  protocol', value: bytes(r.protoBytes) },
          { label: '  unclassified', value: bytes(r.unknownBytes) },
        ]}
      />
      <p class="note">
        この request で観測された重複文脈バイト（既出の Exact Fingerprint と一致した分）は{' '}
        {bytes(r.dupBytes)}。request を除外すると一意 context の集合と後続の再利用判定が変わるため、
        反実仮想の削減量としては読まない。大きさは gap 占有率で見る。
      </p>
    </Section>
  );
}
