import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { homeDir } from '../secret.ts';
import type {
  AgentInsert,
  ContentChunkInsert,
  MeasurementProfile,
  RequestInsert,
  StructuralBlockInsert,
  TaskInsert,
} from '../types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

export function defaultDbPath(): string {
  return path.join(homeDir(), 'profiler.sqlite');
}

export function openDb(dbPath: string = defaultDbPath()): DatabaseSync {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  migrate(db);
  return db;
}

// Read-only handle for the localhost UI (docs/ui-information-design.md §6).
// Deliberately skips PRAGMA/schema/migrate: those are writes and would fail
// on a readOnly connection anyway. Everything the UI reads goes through this
// handle; the one mutation it is allowed to make — explicit task deletion
// (ADR-0014, local data lifecycle) — opens its own short-lived handle below.
export function openDbReadOnly(dbPath: string = defaultDbPath()): DatabaseSync {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`no profiler database at ${dbPath} — run 'token-profiler wrap' first`);
  }
  return new DatabaseSync(dbPath, { readOnly: true });
}

// Short-lived read-write handle for the UI's only mutating operation: deleting
// a Task and its owned rows (ADR-0014). Unlike openDb() it does not re-run
// schema/migrate — the UI never creates rows, only removes ones that exist —
// and it sets a busy timeout so a delete can wait out a concurrent `wrap`
// writer instead of failing immediately.
export function openDbReadWrite(dbPath: string = defaultDbPath()): DatabaseSync {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`no profiler database at ${dbPath}`);
  }
  return new DatabaseSync(dbPath, { timeout: 5000 });
}

// Delete one Task and every row it owns, child-first so foreign keys hold at
// every step. Refuses a Task that is still running (ended_at IS NULL) — that
// is the one `wrap` might be actively writing to — unless `force` is set.
//
// `force` exists because `wrap` only sets ended_at on a clean exit
// (src/wrap.ts); a killed terminal, `kill -9`, or a crash before that point
// leaves the Task permanently `ended_at IS NULL` with no other path to ever
// mark it ended. Without `force` such a Task could never be deleted. The
// caller (server.ts) still requires the same confirmTaskId match either way.
// Returns the request count that was removed (for the confirmation the UI
// already showed the user).
export function deleteTask(
  db: DatabaseSync,
  taskId: string,
  opts: { force?: boolean } = {}
): { deletedRequests: number } {
  const task = db.prepare('SELECT ended_at FROM tasks WHERE task_id = ?').get(taskId) as
    | { ended_at: string | null }
    | undefined;
  if (!task) throw new Error(`unknown task: ${taskId}`);
  if (task.ended_at == null && !opts.force) throw new Error(`task is still running: ${taskId}`);

  const countRow = db
    .prepare('SELECT COUNT(*) AS n FROM requests WHERE task_id = ?')
    .get(taskId) as { n: number };

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `DELETE FROM content_chunks WHERE request_id IN (SELECT request_id FROM requests WHERE task_id = ?)`
    ).run(taskId);
    db.prepare(
      `DELETE FROM structural_blocks WHERE request_id IN (SELECT request_id FROM requests WHERE task_id = ?)`
    ).run(taskId);
    db.prepare('DELETE FROM requests WHERE task_id = ?').run(taskId);
    db.prepare('DELETE FROM agents WHERE task_id = ?').run(taskId);
    db.prepare('DELETE FROM tasks WHERE task_id = ?').run(taskId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { deletedRequests: countRow.n };
}

// `CREATE TABLE IF NOT EXISTS` (above) never alters a table that already
// exists on disk from an earlier version of schema.sql. New nullable
// columns get added here, guarded so re-running against an
// already-migrated DB is a no-op (SQLite has no `ADD COLUMN IF NOT EXISTS`).
function migrate(db: DatabaseSync): void {
  const addColumnIfMissing = (table: string, column: string, ddl: string): void => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (cols.some((c) => c.name === column)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  addColumnIfMissing('requests', 'thread_external_id', 'thread_external_id TEXT');
  addColumnIfMissing('requests', 'is_subagent', 'is_subagent INTEGER');
}

export function ensureMeasurementProfile(db: DatabaseSync, profile: MeasurementProfile): void {
  const existing = db.prepare('SELECT id FROM measurement_profile WHERE id = ?').get(profile.id);
  if (existing) return;
  db.prepare(
    `INSERT INTO measurement_profile
      (id, normalization_version, chunking_algorithm, chunking_version, min_size, avg_size, max_size, fingerprint_algorithm, fingerprint_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    profile.id,
    profile.normalizationVersion,
    profile.chunkingAlgorithm,
    profile.chunkingVersion,
    profile.minSize,
    profile.avgSize,
    profile.maxSize,
    profile.fingerprintAlgorithm,
    profile.fingerprintVersion
  );
}

export function insertTask(
  db: DatabaseSync,
  { taskId, createdAt, measurementProfileId, fingerprintKeyId }: TaskInsert
): void {
  db.prepare(
    `INSERT INTO tasks (task_id, created_at, measurement_profile_id, fingerprint_key_id) VALUES (?, ?, ?, ?)`
  ).run(taskId, createdAt, measurementProfileId, fingerprintKeyId);
}

export function endTask(db: DatabaseSync, taskId: string, endedAt: string): void {
  db.prepare(`UPDATE tasks SET ended_at = ? WHERE task_id = ?`).run(endedAt, taskId);
}

export function insertAgent(db: DatabaseSync, { agentId, taskId, agentRole, createdAt }: AgentInsert): void {
  db.prepare(`INSERT INTO agents (agent_id, task_id, agent_role, created_at) VALUES (?, ?, ?, ?)`).run(
    agentId,
    taskId,
    agentRole ?? null,
    createdAt
  );
}

export function insertRequest(db: DatabaseSync, req: RequestInsert): void {
  db.prepare(
    `INSERT INTO requests
      (request_id, task_id, agent_id, request_index, timestamp, model, provider, operation_type,
       provider_reported_input_tokens, provider_reported_output_tokens,
       cache_creation_input_tokens, cache_read_input_tokens, latency_ms,
       thread_external_id, is_subagent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    req.requestId,
    req.taskId,
    req.agentId,
    req.requestIndex,
    req.timestamp,
    req.model ?? null,
    req.provider,
    req.operationType ?? null,
    req.providerReportedInputTokens ?? null,
    req.providerReportedOutputTokens ?? null,
    req.cacheCreationInputTokens ?? null,
    req.cacheReadInputTokens ?? null,
    req.latencyMs ?? null,
    req.threadExternalId ?? null,
    req.isSubagent === true ? 1 : req.isSubagent === false ? 0 : null
  );
}

export function insertStructuralBlock(db: DatabaseSync, b: StructuralBlockInsert): void {
  db.prepare(
    `INSERT INTO structural_blocks (block_id, request_id, seq, type, transport_role, context_class, block_fingerprint, byte_length)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(b.blockId, b.requestId, b.seq, b.type, b.transportRole ?? null, b.contextClass, b.blockFingerprint, b.byteLength);
}

export function insertContentChunk(db: DatabaseSync, c: ContentChunkInsert): void {
  db.prepare(
    `INSERT INTO content_chunks (chunk_id, block_id, request_id, seq, byte_length, exact_fingerprint, fingerprint_key_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(c.chunkId, c.blockId, c.requestId, c.seq, c.byteLength, c.exactFingerprint, c.fingerprintKeyId);
}
