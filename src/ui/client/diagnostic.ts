// Diagnostic reading of Context Amplification (ADR-0016). Pure functions over
// computeTaskMetrics output — no new measurement. "Duplicate context bytes" per
// request = exactReuseByRequest[i].reusedBytes (Σ ≒ CTV − UCV); reference zones,
// Pareto, and the Next-focus picks are all derived from that, deterministically.

import type { TaskMetrics, RequestRow } from './api.ts';

export type Zone = 'ok' | 'watch' | 'warn' | 'crit';

const PALETTE = [
  '#2f6feb', '#e36209', '#1a7f37', '#8250df', '#cf222e', '#0969da', '#953800', '#57606a',
];

export function zone(amp: number | null | undefined): Zone {
  const a = amp ?? 1;
  return a >= 10 ? 'crit' : a >= 5 ? 'warn' : a >= 2 ? 'watch' : 'ok';
}

// Descriptive ratio-range label for the reference zone (ADR-0017 softens the
// ADR-0016 OK/Watch/Warning/Critical wording). The zone COLOUR still carries
// the heuristic band; the text stays a plain measured range so a word like
// "Critical" can't be read as a defect verdict.
export function zoneLabel(amp: number | null | undefined): string {
  const z = zone(amp);
  return z === 'crit' ? '10x 以上' : z === 'warn' ? '5–10x' : z === 'watch' ? '2–5x' : '1–2x';
}

export const ZONE_COLOR: Record<Zone, string> = {
  ok: '#1a7f37',
  watch: '#2f6feb',
  warn: '#b7791f',
  crit: '#cf222e',
};

// Reference bands for the threshold plot (heuristic — not a Fact; ADR-0016,
// labels softened to plain ranges by ADR-0017).
export const ZONE_BANDS: { from: number; to: number; zone: Zone; label: string }[] = [
  { from: 0, to: 2, zone: 'ok', label: '1–2x' },
  { from: 2, to: 5, zone: 'watch', label: '2–5x' },
  { from: 5, to: 10, zone: 'warn', label: '5–10x' },
  { from: 10, to: Infinity, zone: 'crit', label: '10x 以上' },
];

export const threadKeyOf = (r: RequestRow): string =>
  r.threadExternalId == null ? 'unknown' : String(r.threadExternalId);

// Per-request diagnostic row, in request order.
export interface DupRow {
  requestIndex: number;
  thread: string;
  dupBytes: number; // reusedBytes — contribution to CTV − UCV
  appBytes: number; // application-context bytes (= totalBytes)
  uniqueBytes: number; // appBytes − dupBytes
  reuse: number; // exactReuseRatio, 0..1
  gapShare: number; // dupBytes / gap
  transported: number;
  protoBytes: number;
  unknownBytes: number;
  runningAmp: number; // cumulative CTV/UCV up to & including this request (approx)
}

export interface ThreadDup {
  thread: string;
  color: string;
  count: number;
  appBytes: number;
  protoBytes: number;
  unknownBytes: number;
  transported: number;
  dupBytes: number;
  gapShare: number;
}

export interface Diagnostic {
  amp: number; // metrics.contextAmplification, or the last running value
  ucv: number; // Σ uniqueBytes (approx of metrics.ucv)
  ctv: number; // Σ appBytes    (approx of metrics.ctv)
  gap: number; // Σ dupBytes    (≒ CTV − UCV)
  rows: DupRow[]; // request order
  threads: ThreadDup[]; // dupBytes desc
  ranked: DupRow[]; // dupBytes desc
  pareto: { rank: number; cumShare: number }[];
  k50: number; // request count reaching 50% of the gap
  k80: number; // request count reaching 80% of the gap
  slope: number; // running-amp change per request
  first5: number | null; // requestIndex where running-amp first ≥ 5x
  topThread: ThreadDup | null;
  topReq: DupRow | null;
  colorOfThread: (thread: string) => string;
}

export function derive(metrics: TaskMetrics): Diagnostic {
  const reqRows = (metrics.requestRows ?? [])
    .slice()
    .sort((a, b) => a.requestIndex - b.requestIndex);
  const reuseByIdx = new Map(
    (metrics.exactReuseByRequest ?? []).map((e) => [
      e.requestIndex,
      { reusedBytes: e.reusedBytes || 0, totalBytes: e.totalBytes || 0 },
    ])
  );

  let ctv = 0;
  let ucv = 0;
  const rows: DupRow[] = reqRows.map((r) => {
    const e = reuseByIdx.get(r.requestIndex);
    const appBytes = e?.totalBytes || r.applicationBytes || 0;
    const dupBytes = e ? e.reusedBytes : Math.round(appBytes * (r.exactReuseRatio ?? 0));
    const uniqueBytes = Math.max(0, appBytes - dupBytes);
    ctv += appBytes;
    ucv += uniqueBytes;
    return {
      requestIndex: r.requestIndex,
      thread: threadKeyOf(r),
      dupBytes,
      appBytes,
      uniqueBytes,
      reuse: r.exactReuseRatio ?? (appBytes ? dupBytes / appBytes : 0),
      gapShare: 0,
      transported: (r.applicationBytes || 0) + (r.protocolBytes || 0) + (r.unknownBytes || 0),
      protoBytes: r.protocolBytes || 0,
      unknownBytes: r.unknownBytes || 0,
      runningAmp: ucv > 0 ? ctv / ucv : 1,
    };
  });

  const gap = Math.max(0, ctv - ucv);
  for (const row of rows) row.gapShare = gap > 0 ? row.dupBytes / gap : 0;

  const tmap = new Map<string, ThreadDup>();
  for (const row of rows) {
    let t = tmap.get(row.thread);
    if (!t) {
      t = {
        thread: row.thread,
        color: PALETTE[tmap.size % PALETTE.length],
        count: 0,
        appBytes: 0,
        protoBytes: 0,
        unknownBytes: 0,
        transported: 0,
        dupBytes: 0,
        gapShare: 0,
      };
      tmap.set(row.thread, t);
    }
    t.count += 1;
    t.appBytes += row.appBytes;
    t.protoBytes += row.protoBytes;
    t.unknownBytes += row.unknownBytes;
    t.transported += row.transported;
    t.dupBytes += row.dupBytes;
  }
  const threads = [...tmap.values()].sort((a, b) => b.dupBytes - a.dupBytes);
  for (const t of threads) t.gapShare = gap > 0 ? t.dupBytes / gap : 0;
  const colorByThread = new Map(threads.map((t) => [t.thread, t.color]));

  const ranked = rows.slice().sort((a, b) => b.dupBytes - a.dupBytes);
  let cum = 0;
  const pareto = ranked.map((r, i) => {
    cum += r.dupBytes;
    return { rank: i + 1, cumShare: gap > 0 ? cum / gap : 0 };
  });
  const kAt = (frac: number): number => {
    const i = pareto.findIndex((p) => p.cumShare >= frac);
    return i < 0 ? ranked.length : i + 1;
  };

  const slope =
    rows.length > 1
      ? (rows[rows.length - 1].runningAmp - rows[0].runningAmp) / (rows.length - 1)
      : 0;
  const first5 = rows.find((r) => r.runningAmp >= 5)?.requestIndex ?? null;
  const amp =
    metrics.contextAmplification ?? (rows.length ? rows[rows.length - 1].runningAmp : 1);

  return {
    amp,
    ucv,
    ctv,
    gap,
    rows,
    threads,
    ranked,
    pareto,
    k50: kAt(0.5),
    k80: kAt(0.8),
    slope,
    first5,
    topThread: threads[0] ?? null,
    topReq: ranked[0] ?? null,
    colorOfThread: (thread: string): string => colorByThread.get(thread) ?? '#57606a',
  };
}
