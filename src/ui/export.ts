import type { DatabaseSync } from 'node:sqlite';

import { computeTaskMetrics } from '../core/metrics.ts';
import type { ContextClass, RequestRow, ThreadBreakdownRow } from '../types.ts';

// Raw-data export for the localhost UI (docs/ui-information-design.md §3.5).
// The profiler collects and reports; it does not interpret. These endpoints
// hand the numbers to an external tool unchanged — CSV / JSON Lines / the
// full computeTaskMetrics JSON — optionally scoped to the UI's current
// filter (thread / context_class). No Core Measurement formula runs here.

export type ExportKind =
  | 'export.json'
  | 'requests.csv'
  | 'requests.jsonl'
  | 'threads.csv'
  | 'blocks.csv';

export interface ExportFilter {
  thread?: string | null;
  contextClass?: string | null;
}

export interface ExportResult {
  body: string;
  contentType: string;
  filename: string;
}

// One StructuralBlock per row, joined to its request so a thread /
// context_class scope can be applied. Passthrough of stored columns only.
interface StructuralBlockRow {
  requestIndex: number;
  seq: number;
  type: string;
  transportRole: string | null;
  contextClass: ContextClass;
  byteLength: number;
  threadExternalId: string | null;
  isSubagent: boolean | null;
}

const threadKeyOf = (v: string | null): string => (v == null ? 'unknown' : v);

function taskExists(db: DatabaseSync, taskId: string): boolean {
  return db.prepare('SELECT 1 FROM tasks WHERE task_id = ?').get(taskId) != null;
}

function structuralBlockRows(db: DatabaseSync, taskId: string): StructuralBlockRow[] {
  const rows = db
    .prepare(
      `SELECT r.request_index AS request_index, sb.seq AS seq, sb.type AS type,
              sb.transport_role AS transport_role, sb.context_class AS context_class,
              sb.byte_length AS byte_length, r.thread_external_id AS thread_external_id,
              r.is_subagent AS is_subagent
       FROM structural_blocks sb
       JOIN requests r ON r.request_id = sb.request_id
       WHERE r.task_id = ?
       ORDER BY r.request_index, sb.seq`
    )
    .all(taskId) as unknown as Array<{
    request_index: number;
    seq: number;
    type: string;
    transport_role: string | null;
    context_class: ContextClass;
    byte_length: number;
    thread_external_id: string | null;
    is_subagent: number | null;
  }>;

  return rows.map((r) => ({
    requestIndex: r.request_index,
    seq: r.seq,
    type: r.type,
    transportRole: r.transport_role ?? null,
    contextClass: r.context_class,
    byteLength: r.byte_length,
    threadExternalId: r.thread_external_id ?? null,
    isSubagent: r.is_subagent === null ? null : Boolean(r.is_subagent),
  }));
}

// --- serializers -----------------------------------------------------------

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv<T extends Record<string, unknown>>(columns: (keyof T)[], rows: T[]): string {
  const lines = [columns.map((c) => csvCell(c as string)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

function toJsonl(rows: unknown[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
}

// --- column orders (stable, camelCase == types.ts field names) -----------

const REQUEST_COLUMNS: (keyof RequestRow)[] = [
  'requestIndex',
  'timestamp',
  'model',
  'operationType',
  'providerReportedInputTokens',
  'providerReportedOutputTokens',
  'cacheCreationInputTokens',
  'cacheReadInputTokens',
  'applicationBytes',
  'protocolBytes',
  'unknownBytes',
  'exactReuseRatio',
  'latencyMs',
  'threadExternalId',
  'isSubagent',
];

const THREAD_COLUMNS: (keyof ThreadBreakdownRow)[] = [
  'threadExternalId',
  'isSubagent',
  'requestCount',
  'inputTokens',
  'outputTokens',
  'cacheCreationTokens',
  'cacheReadTokens',
  'firstRequestIndex',
];

const BLOCK_COLUMNS: (keyof StructuralBlockRow)[] = [
  'requestIndex',
  'seq',
  'type',
  'transportRole',
  'contextClass',
  'byteLength',
  'threadExternalId',
  'isSubagent',
];

// --- filename helpers ---------------------------------------------------

function scopeSuffix(filter: ExportFilter): string {
  if (filter.thread != null && filter.thread !== '') return `-thread-${slug(filter.thread)}`;
  if (filter.contextClass != null && filter.contextClass !== '')
    return `-class-${slug(filter.contextClass)}`;
  return '';
}

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 40);
}

// --- entry point -----------------------------------------------------

export function buildExport(
  db: DatabaseSync,
  taskId: string,
  kind: ExportKind,
  filter: ExportFilter = {}
): ExportResult {
  if (!taskExists(db, taskId)) throw new Error(`unknown task: ${taskId}`);

  const id8 = taskId.slice(0, 8);
  const thread = filter.thread != null && filter.thread !== '' ? filter.thread : null;
  const ctxClass =
    filter.contextClass != null && filter.contextClass !== '' ? filter.contextClass : null;

  if (kind === 'export.json') {
    const metrics = computeTaskMetrics(db, taskId);
    // Be explicit about what a filter did and did NOT touch (ui-review §2):
    // a thread scope narrows the row-oriented arrays; context_class is a
    // StructuralBlock attribute, so it cannot narrow request/thread rows and
    // is only recorded here, not applied.
    const filterAppliedTo: string[] = [];
    if (thread != null) {
      metrics.requestRows = metrics.requestRows.filter(
        (r) => threadKeyOf(r.threadExternalId) === thread
      );
      metrics.threadBreakdown = metrics.threadBreakdown.filter(
        (t) => threadKeyOf(t.threadExternalId) === thread
      );
      filterAppliedTo.push('requestRows', 'threadBreakdown');
    }
    const scalarsNote =
      'Scalar Core Measurements (ucv, ctv, contextAmplification, transportByClass, ' +
      'totalTransport, protocolShare, exactReuseByRequest, observedTokenTraffic) are ' +
      'always task-level and are not narrowed by any filter.';
    return {
      body:
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            filter: { thread, contextClass: ctxClass },
            filterAppliedTo,
            note:
              ctxClass != null
                ? `context_class is recorded but not applied to this payload (block-level attribute). ${scalarsNote}`
                : scalarsNote,
            metrics,
          },
          null,
          2
        ) + '\n',
      contentType: 'application/json; charset=utf-8',
      filename: `task-${id8}-metrics${scopeSuffix({ thread, contextClass: ctxClass })}.json`,
    };
  }

  if (kind === 'requests.csv' || kind === 'requests.jsonl') {
    let rows = computeTaskMetrics(db, taskId).requestRows;
    if (thread != null) rows = rows.filter((r) => threadKeyOf(r.threadExternalId) === thread);
    const suffix = scopeSuffix({ thread });
    if (kind === 'requests.csv') {
      return {
        body: toCsv(REQUEST_COLUMNS, rows as unknown as Record<string, unknown>[]),
        contentType: 'text/csv; charset=utf-8',
        filename: `task-${id8}-requests${suffix}.csv`,
      };
    }
    return {
      body: toJsonl(rows),
      contentType: 'application/x-ndjson; charset=utf-8',
      filename: `task-${id8}-requests${suffix}.jsonl`,
    };
  }

  if (kind === 'threads.csv') {
    let rows = computeTaskMetrics(db, taskId).threadBreakdown;
    if (thread != null) rows = rows.filter((t) => threadKeyOf(t.threadExternalId) === thread);
    return {
      body: toCsv(THREAD_COLUMNS, rows as unknown as Record<string, unknown>[]),
      contentType: 'text/csv; charset=utf-8',
      filename: `task-${id8}-threads${scopeSuffix({ thread })}.csv`,
    };
  }

  // blocks.csv — the one export where context_class is a meaningful scope
  // (context_class is a StructuralBlock attribute, not a request attribute).
  let rows = structuralBlockRows(db, taskId);
  if (thread != null) rows = rows.filter((b) => threadKeyOf(b.threadExternalId) === thread);
  if (ctxClass != null) rows = rows.filter((b) => b.contextClass === ctxClass);
  return {
    body: toCsv(BLOCK_COLUMNS, rows as unknown as Record<string, unknown>[]),
    contentType: 'text/csv; charset=utf-8',
    filename: `task-${id8}-blocks${scopeSuffix({ thread, contextClass: ctxClass })}.csv`,
  };
}
