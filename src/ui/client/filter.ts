import type { RequestRow, ThreadBreakdownRow, TaskMetrics } from './api.ts';
import type { UiState } from './urlState.ts';

// `unknown` is the display key for a null thread id — matches export.ts and the
// pre-Preact client so filter values line up across UI and downloads.
export const threadKeyOfRow = (r: RequestRow): string =>
  r.threadExternalId == null ? 'unknown' : String(r.threadExternalId);

export const threadKeyOfBreakdown = (t: ThreadBreakdownRow): string =>
  t.threadExternalId == null ? 'unknown' : String(t.threadExternalId);

export function filteredRequestRows(metrics: TaskMetrics, state: UiState): RequestRow[] {
  const rows = metrics.requestRows ?? [];
  if (state.filter === 'thread' && state.thread != null)
    return rows.filter((r) => threadKeyOfRow(r) === state.thread);
  return rows;
}

export function sumField<T>(rows: T[], field: keyof T): number {
  return rows.reduce((a, r) => a + (Number(r[field]) || 0), 0);
}

// Nullable per-request provider-usage fields. `null` means that request's
// usage was not reported (Observed tier — the provider didn't send it).
export type UsageField =
  | 'providerReportedInputTokens'
  | 'providerReportedOutputTokens'
  | 'cacheCreationInputTokens'
  | 'cacheReadInputTokens';

// Sum a nullable usage field, keeping how many rows actually carried a value.
// `have === 0` → nothing reported (show 不明), `0 < have < total` → partial,
// `have === total` → complete. A genuine 0 counts as reported, so measured
// zero stays distinct from "not reported".
export function usageAgg(
  rows: RequestRow[],
  field: UsageField
): { sum: number; have: number; total: number } {
  let sum = 0;
  let have = 0;
  for (const r of rows) {
    const v = r[field];
    if (v != null) {
      sum += v;
      have += 1;
    }
  }
  return { sum, have, total: rows.length };
}

// Observed span = max − min over the rows' parseable start timestamps, in ms.
// request_index is assigned at response completion, so the array is not in
// wall-clock order under parallel requests — the ends can't be trusted.
// `null` when fewer than two timestamps parse.
export function observedSpanMs(rows: RequestRow[]): number | null {
  const ts: number[] = [];
  for (const r of rows) {
    const t = Date.parse(r.timestamp);
    if (Number.isFinite(t)) ts.push(t);
  }
  if (ts.length < 2) return null;
  return Math.max(...ts) - Math.min(...ts);
}

// Cache read share on the billing axis:
//   cache_read / (uncached input + cache_creation + cache_read)
// summed over ONLY the requests that reported all three — a missing cache_read
// must not read as 0. `share` is null when no request qualified (or the
// denominator is 0); `n` of `total` rows contributed.
export function cacheReadShare(rows: RequestRow[]): {
  share: number | null;
  n: number;
  total: number;
} {
  let inS = 0;
  let ccS = 0;
  let crS = 0;
  let n = 0;
  for (const r of rows) {
    const i = r.providerReportedInputTokens;
    const c = r.cacheCreationInputTokens;
    const rd = r.cacheReadInputTokens;
    if (i == null || c == null || rd == null) continue;
    inS += i;
    ccS += c;
    crS += rd;
    n += 1;
  }
  const denom = inS + ccS + crS;
  return { share: n > 0 && denom > 0 ? crS / denom : null, n, total: rows.length };
}

// Export query string for the current filter, matching what view 6 offers:
// ?thread= applies to every kind; ?context_class= only to blocks.csv.
export function exportQuery(state: UiState, kind: string): string {
  if (state.filter === 'thread' && state.thread != null)
    return '?thread=' + encodeURIComponent(state.thread);
  if (state.filter === 'context_class' && state.cls != null && kind === 'blocks.csv')
    return '?context_class=' + encodeURIComponent(state.cls);
  return '';
}

export const EXPORT_LABEL: Record<string, string> = {
  'export.json': 'metrics.json',
  'requests.csv': 'requests.csv',
  'requests.jsonl': 'requests.jsonl',
  'threads.csv': 'threads.csv',
  'blocks.csv': 'blocks.csv',
};
