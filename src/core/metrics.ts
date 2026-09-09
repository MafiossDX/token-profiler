import type { DatabaseSync } from 'node:sqlite';
import type {
  ExactReuseByRequest,
  ContextClass,
  RequestRow,
  TaskMetrics,
  ThreadBreakdownRow,
} from '../types.ts';

// UCV / CTV / Context Amplification / Exact Reuse Ratio / Classification
// Coverage (CONTEXT.md), computed over what ingest.ts already persisted.
// byte basis only for v0 (token basis needs a local tokenizer, out of scope).

// Context Amplification for every Task in one pass — the localhost UI's task
// list (src/ui/server.ts listTasks()) needs only this one number per Task,
// not the full computeTaskMetrics() (exact-reuse JS loop, thread breakdown,
// per-request rows). Two aggregate queries regardless of Task count, instead
// of computeTaskMetrics() run once per Task. Same UCV/CTV formulas and same
// `ucv > 0 ? ctv / ucv : null` rule as computeTaskMetrics — a Task absent
// from either map (no ingested content yet) naturally comes out null.
export function computeContextAmplificationForAllTasks(
  db: DatabaseSync
): Map<string, number | null> {
  const ucvRows = db
    .prepare(
      `SELECT task_id, SUM(byte_length) as ucv FROM (
         SELECT r.task_id as task_id, cc.byte_length,
                ROW_NUMBER() OVER (
                  PARTITION BY r.task_id, cc.exact_fingerprint
                  ORDER BY r.request_index, sb.seq, cc.seq
                ) as rn
         FROM content_chunks cc
         JOIN structural_blocks sb ON sb.block_id = cc.block_id
         JOIN requests r ON r.request_id = cc.request_id
         JOIN tasks t ON t.task_id = r.task_id
         WHERE sb.context_class = 'application' AND cc.fingerprint_key_id = t.fingerprint_key_id
       ) WHERE rn = 1
       GROUP BY task_id`
    )
    .all() as Array<{ task_id: string; ucv: number | null }>;

  const ctvRows = db
    .prepare(
      `SELECT r.task_id as task_id, SUM(cc.byte_length) as ctv
       FROM content_chunks cc
       JOIN structural_blocks sb ON sb.block_id = cc.block_id
       JOIN requests r ON r.request_id = cc.request_id
       WHERE sb.context_class = 'application'
       GROUP BY r.task_id`
    )
    .all() as Array<{ task_id: string; ctv: number | null }>;

  const ucvByTask = new Map(ucvRows.map((r) => [r.task_id, r.ucv ?? 0]));
  const ctvByTask = new Map(ctvRows.map((r) => [r.task_id, r.ctv ?? 0]));

  const result = new Map<string, number | null>();
  for (const taskId of new Set([...ucvByTask.keys(), ...ctvByTask.keys()])) {
    const ucv = ucvByTask.get(taskId) ?? 0;
    const ctv = ctvByTask.get(taskId) ?? 0;
    result.set(taskId, ucv > 0 ? ctv / ucv : null);
  }
  return result;
}

export function computeTaskMetrics(db: DatabaseSync, taskId: string): TaskMetrics {
  const profileRow = db
    .prepare(`SELECT fingerprint_key_id FROM tasks WHERE task_id = ?`)
    .get(taskId) as { fingerprint_key_id: string } | undefined;
  if (!profileRow) throw new Error(`unknown task: ${taskId}`);
  const fingerprintKeyId = profileRow.fingerprint_key_id;

  // CROSS JOIN (not JOIN) pins the join order to requests -> content_chunks
  // -> structural_blocks so SQLite starts from idx_requests_task (this
  // task's rows only). INDEXED BY idx_chunks_request pins cc's own index
  // too — without it, the planner still sometimes prefers
  // idx_chunks_fingerprint for cc even as the inner loop, which re-scans
  // every chunk sharing this fingerprint_key_id (shared by every Task on
  // the same measurement profile) once per outer row — worse than the
  // original. Both hints together: verified equivalent result, ~1.7s -> ~4ms.
  const ucvRow = db
    .prepare(
      `SELECT SUM(byte_length) as ucv FROM (
         SELECT cc.byte_length,
                ROW_NUMBER() OVER (PARTITION BY cc.exact_fingerprint ORDER BY r.request_index, sb.seq, cc.seq) as rn
         FROM requests r
         CROSS JOIN content_chunks cc INDEXED BY idx_chunks_request ON cc.request_id = r.request_id
         CROSS JOIN structural_blocks sb ON sb.block_id = cc.block_id
         WHERE r.task_id = ? AND sb.context_class = 'application' AND cc.fingerprint_key_id = ?
       ) WHERE rn = 1`
    )
    .get(taskId, fingerprintKeyId) as { ucv: number | null };

  const ctvRow = db
    .prepare(
      `SELECT SUM(cc.byte_length) as ctv
       FROM content_chunks cc
       JOIN structural_blocks sb ON sb.block_id = cc.block_id
       JOIN requests r ON r.request_id = cc.request_id
       WHERE r.task_id = ? AND sb.context_class = 'application'`
    )
    .get(taskId) as { ctv: number | null };

  const ucv = ucvRow.ucv ?? 0;
  const ctv = ctvRow.ctv ?? 0;
  const contextAmplification = ucv > 0 ? ctv / ucv : null;

  const classRows = db
    .prepare(
      `SELECT sb.context_class as context_class, SUM(sb.byte_length) as bytes
       FROM structural_blocks sb
       JOIN requests r ON r.request_id = sb.request_id
       WHERE r.task_id = ?
       GROUP BY sb.context_class`
    )
    .all(taskId) as Array<{ context_class: ContextClass; bytes: number }>;

  const byClass: Record<ContextClass, number> = { application: 0, protocol: 0, unknown: 0 };
  for (const row of classRows) byClass[row.context_class] = row.bytes;
  const totalTransport = byClass.application + byClass.protocol + byClass.unknown;
  const classificationCoverage =
    totalTransport > 0 ? (byClass.application + byClass.protocol) / totalTransport : null;
  const protocolShare = totalTransport > 0 ? byClass.protocol / totalTransport : null;

  const exactReuseByRequest = computeExactReuseByRequest(db, taskId, fingerprintKeyId);
  const threadBreakdown = computeThreadBreakdown(db, taskId);
  const requestRows = computeRequestRows(db, taskId);

  // Join the per-request Exact Reuse Ratio onto the raw rows so the Requests
  // table and requests.* exports carry it without a second lookup. Core
  // Measurement formulas are untouched — this only copies an already-computed
  // value into a presentation aid.
  const reuseByIndex = new Map(exactReuseByRequest.map((e) => [e.requestIndex, e.exactReuseRatio]));
  for (const row of requestRows) row.exactReuseRatio = reuseByIndex.get(row.requestIndex) ?? null;

  const usageRow = db
    .prepare(
      `SELECT
         SUM(provider_reported_input_tokens) as input_tokens,
         SUM(provider_reported_output_tokens) as output_tokens,
         SUM(cache_creation_input_tokens) as cache_creation_tokens,
         SUM(cache_read_input_tokens) as cache_read_tokens,
         COUNT(*) as request_count
       FROM requests WHERE task_id = ?`
    )
    .get(taskId) as {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_creation_tokens: number | null;
    cache_read_tokens: number | null;
    request_count: number | null;
  };

  return {
    taskId,
    basis: 'byte',
    ucv,
    ctv,
    contextAmplification,
    classificationCoverage,
    protocolShare,
    transportByClass: byClass,
    totalTransport,
    exactReuseByRequest,
    threadBreakdown,
    requestRows,
    observedTokenTraffic: {
      inputTokens: usageRow.input_tokens ?? 0,
      outputTokens: usageRow.output_tokens ?? 0,
      cacheCreationTokens: usageRow.cache_creation_tokens ?? 0,
      cacheReadTokens: usageRow.cache_read_tokens ?? 0,
      requestCount: usageRow.request_count ?? 0,
    },
  };
}

interface ReuseRow {
  request_id: string;
  request_index: number;
  exact_fingerprint: string;
  byte_length: number;
}

// Exact Reuse Ratio (CONTEXT.md): per request, share of that request's
// Application Context bytes whose Exact Fingerprint already appeared in an
// EARLIER request in the same Task. Computed in JS (not SQL) because the
// "already seen" set is inherently sequential over request_index.
function computeExactReuseByRequest(
  db: DatabaseSync,
  taskId: string,
  fingerprintKeyId: string
): ExactReuseByRequest[] {
  // Same idx_chunks_fingerprint pitfall as the UCV query in computeTaskMetrics
  // above — CROSS JOIN pins the join order, INDEXED BY pins cc's own index,
  // so this stays scoped to the task instead of scanning every chunk sharing
  // this fingerprint_key_id across all Tasks (once per outer row, if only the
  // join order were pinned — see the comment above the UCV query).
  const rows = db
    .prepare(
      `SELECT r.request_id as request_id, r.request_index as request_index,
              cc.exact_fingerprint as exact_fingerprint, cc.byte_length as byte_length
       FROM requests r
       CROSS JOIN content_chunks cc INDEXED BY idx_chunks_request ON cc.request_id = r.request_id
       CROSS JOIN structural_blocks sb ON sb.block_id = cc.block_id
       WHERE r.task_id = ? AND sb.context_class = 'application' AND cc.fingerprint_key_id = ?
       ORDER BY r.request_index, sb.seq, cc.seq`
    )
    .all(taskId, fingerprintKeyId) as unknown as ReuseRow[];

  const byRequest = new Map<string, { requestId: string; requestIndex: number; rows: ReuseRow[] }>();
  for (const row of rows) {
    let entry = byRequest.get(row.request_id);
    if (!entry) {
      entry = { requestId: row.request_id, requestIndex: row.request_index, rows: [] };
      byRequest.set(row.request_id, entry);
    }
    entry.rows.push(row);
  }

  const orderedRequests = [...byRequest.values()].sort((a, b) => a.requestIndex - b.requestIndex);

  // A fingerprint only counts as "reused" if it was seen in a STRICTLY
  // earlier request — globalSeen is updated after scoring each request, so a
  // request never gets credit for reusing its own chunks.
  const globalSeen = new Set<string>();
  const result: ExactReuseByRequest[] = [];
  for (const req of orderedRequests) {
    let total = 0;
    let reused = 0;
    for (const row of req.rows) {
      total += row.byte_length;
      if (globalSeen.has(row.exact_fingerprint)) reused += row.byte_length;
    }
    for (const row of req.rows) globalSeen.add(row.exact_fingerprint);
    result.push({
      requestId: req.requestId,
      requestIndex: req.requestIndex,
      exactReuseRatio: total > 0 ? reused / total : null,
      totalBytes: total,
      reusedBytes: reused,
    });
  }
  return result;
}

// Conversation Thread breakdown (ADR-0005/0009/0013): NOT Core Measurement.
// Grouped by `requests.thread_external_id`, which is populated best-effort
// by the Claude Code Enrichment Adapter (verified_best_effort confidence,
// src/enrichment/claude-code.ts) and stays NULL — grouped here as "unknown"
// — whenever its marker was absent or unrecognized. Never a filter axis
// promoted from raw fingerprint circumstantial evidence; this is the
// confidence-backed classifier item 19 asked for.
function computeThreadBreakdown(db: DatabaseSync, taskId: string): ThreadBreakdownRow[] {
  const rows = db
    .prepare(
      `SELECT thread_external_id, is_subagent, COUNT(*) as request_count,
              SUM(provider_reported_input_tokens) as input_tokens,
              SUM(provider_reported_output_tokens) as output_tokens,
              SUM(cache_creation_input_tokens) as cache_creation_tokens,
              SUM(cache_read_input_tokens) as cache_read_tokens,
              MIN(request_index) as first_request_index
       FROM requests
       WHERE task_id = ?
       GROUP BY thread_external_id, is_subagent
       ORDER BY first_request_index`
    )
    .all(taskId) as Array<{
    thread_external_id: string | null;
    is_subagent: number | null;
    request_count: number;
    input_tokens: number | null;
    output_tokens: number | null;
    cache_creation_tokens: number | null;
    cache_read_tokens: number | null;
    first_request_index: number;
  }>;

  return rows.map((r) => ({
    threadExternalId: r.thread_external_id ?? null,
    isSubagent: r.is_subagent === null ? null : Boolean(r.is_subagent),
    requestCount: r.request_count,
    inputTokens: r.input_tokens ?? 0,
    outputTokens: r.output_tokens ?? 0,
    cacheCreationTokens: r.cache_creation_tokens ?? 0,
    cacheReadTokens: r.cache_read_tokens ?? 0,
    firstRequestIndex: r.first_request_index,
  }));
}

// Per-request raw rows for the localhost UI (docs/ui-information-design.md §5).
// Pure passthrough of stored columns, request_index ascending — no derived
// value here participates in a Core Measurement formula.
function computeRequestRows(db: DatabaseSync, taskId: string): RequestRow[] {
  const rows = db
    .prepare(
      `SELECT r.request_index AS request_index, r.timestamp AS timestamp, r.model AS model,
              r.operation_type AS operation_type,
              r.provider_reported_input_tokens AS provider_reported_input_tokens,
              r.provider_reported_output_tokens AS provider_reported_output_tokens,
              r.cache_creation_input_tokens AS cache_creation_input_tokens,
              r.cache_read_input_tokens AS cache_read_input_tokens,
              r.latency_ms AS latency_ms,
              r.thread_external_id AS thread_external_id, r.is_subagent AS is_subagent,
              COALESCE(SUM(CASE WHEN sb.context_class = 'application' THEN sb.byte_length END), 0) AS application_bytes,
              COALESCE(SUM(CASE WHEN sb.context_class = 'protocol' THEN sb.byte_length END), 0) AS protocol_bytes,
              COALESCE(SUM(CASE WHEN sb.context_class = 'unknown' THEN sb.byte_length END), 0) AS unknown_bytes
       FROM requests r
       LEFT JOIN structural_blocks sb ON sb.request_id = r.request_id
       WHERE r.task_id = ?
       GROUP BY r.request_id
       ORDER BY r.request_index`
    )
    .all(taskId) as unknown as Array<{
    request_index: number;
    timestamp: string;
    model: string | null;
    operation_type: string | null;
    provider_reported_input_tokens: number | null;
    provider_reported_output_tokens: number | null;
    cache_creation_input_tokens: number | null;
    cache_read_input_tokens: number | null;
    latency_ms: number | null;
    thread_external_id: string | null;
    is_subagent: number | null;
    application_bytes: number;
    protocol_bytes: number;
    unknown_bytes: number;
  }>;

  return rows.map((r) => ({
    requestIndex: r.request_index,
    timestamp: r.timestamp,
    model: r.model ?? null,
    operationType: r.operation_type ?? null,
    providerReportedInputTokens: r.provider_reported_input_tokens ?? null,
    providerReportedOutputTokens: r.provider_reported_output_tokens ?? null,
    cacheCreationInputTokens: r.cache_creation_input_tokens ?? null,
    cacheReadInputTokens: r.cache_read_input_tokens ?? null,
    latencyMs: r.latency_ms ?? null,
    threadExternalId: r.thread_external_id ?? null,
    isSubagent: r.is_subagent === null ? null : Boolean(r.is_subagent),
    applicationBytes: r.application_bytes,
    protocolBytes: r.protocol_bytes,
    unknownBytes: r.unknown_bytes,
    exactReuseRatio: null, // filled by computeTaskMetrics from exactReuseByRequest
  }));
}
