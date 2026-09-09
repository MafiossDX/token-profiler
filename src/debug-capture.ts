import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from './secret.ts';
import type { ChunkSelector, DebugCaptureFilter, DebugCaptureMeta } from './types.ts';

// Targeted debug row capture (docs/adr/0012-targeted-debug-row-capture.md).
// This is deliberately NOT a general payload-capture feature: it exists to
// let a spike answer a specific, narrow question ("what's in this one
// chunk?") that fingerprints/lengths alone can't answer, without reopening
// ADR-0002's privacy-first default. It is opt-in per `wrap` invocation,
// bounded by max_bytes, scoped to individual ContentChunks (never a whole
// request body), lives outside the git repo and outside the profiler DB,
// and `report`/UI never read from it.

export function debugCaptureRootDir(): string {
  return path.join(homeDir(), 'debug-capture');
}

// "<blockType>:<chunkSelector>:<maxBytes>[,...]"
//   blockType:      structural_blocks.type (e.g. "system", "message"), or "*" for any
//   chunkSelector:  "first" | "last" | "all" | a non-negative integer chunk seq
//   maxBytes:       required, positive integer
export function parseDebugCaptureFilter(spec: string): DebugCaptureFilter[] {
  if (!spec || !spec.trim()) {
    throw new Error('debug-capture filter must not be empty');
  }
  return spec.split(',').map((part): DebugCaptureFilter => {
    const raw = part.trim();
    const fields = raw.split(':');
    if (fields.length !== 3) {
      throw new Error(`invalid debug-capture filter clause '${raw}' (want blockType:chunkSelector:maxBytes)`);
    }
    const [blockType, chunkSelectorRaw, maxBytesRaw] = fields.map((f) => f.trim()) as [string, string, string];
    if (!blockType) {
      throw new Error(`invalid debug-capture filter clause '${raw}': blockType is required`);
    }

    let chunkSelector: ChunkSelector;
    if (chunkSelectorRaw === 'first' || chunkSelectorRaw === 'last' || chunkSelectorRaw === 'all') {
      chunkSelector = chunkSelectorRaw;
    } else if (/^\d+$/.test(chunkSelectorRaw)) {
      chunkSelector = Number(chunkSelectorRaw);
    } else {
      throw new Error(
        `invalid debug-capture filter clause '${raw}': chunkSelector must be 'first'/'last'/'all'/an integer, got '${chunkSelectorRaw}'`
      );
    }

    const maxBytes = Number(maxBytesRaw);
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
      throw new Error(
        `invalid debug-capture filter clause '${raw}': maxBytes must be a positive integer, got '${maxBytesRaw}'`
      );
    }

    return { blockType, chunkSelector, maxBytes };
  });
}

export function describeDebugCaptureFilter(filters: DebugCaptureFilter[], dir: string): string {
  const clauses = filters.map((f) => `${f.blockType}:${f.chunkSelector}:${f.maxBytes}`).join(', ');
  return [
    `[token-profiler] debug-capture ENABLED: ${clauses}`,
    `[token-profiler] debug-capture output: ${dir} (temporary, outside git repo, not read by report/UI)`,
  ].join('\n');
}

interface MatchCaptureArgs {
  blockType: string;
  chunkSeq: number;
  isLastChunk: boolean;
}

export function matchCapture(filters: DebugCaptureFilter[], { blockType, chunkSeq, isLastChunk }: MatchCaptureArgs): DebugCaptureFilter | null {
  for (const f of filters) {
    if (f.blockType !== '*' && f.blockType !== blockType) continue;
    if (f.chunkSelector === 'first' && chunkSeq !== 0) continue;
    if (f.chunkSelector === 'last' && !isLastChunk) continue;
    if (typeof f.chunkSelector === 'number' && f.chunkSelector !== chunkSeq) continue;
    return f;
  }
  return null;
}

interface CaptureChunkArgs {
  dir: string;
  taskId: string;
  requestId: string;
  requestIndex: number;
  blockSeq: number;
  blockType: string;
  chunkSeq: number;
  buf: Buffer;
  maxBytes: number;
}

export function captureChunk({
  dir,
  taskId,
  requestId,
  requestIndex,
  blockSeq,
  blockType,
  chunkSeq,
  buf,
  maxBytes,
}: CaptureChunkArgs): void {
  const taskDir = path.join(dir, taskId);
  fs.mkdirSync(taskDir, { recursive: true });

  const base = `${requestIndex}-${blockSeq}-${chunkSeq}`;
  const truncated = buf.length > maxBytes;
  const captured = truncated ? buf.subarray(0, maxBytes) : buf;

  fs.writeFileSync(path.join(taskDir, `${base}.txt`), captured.toString('utf8'));
  const meta: DebugCaptureMeta = {
    task_id: taskId,
    request_id: requestId,
    request_index: requestIndex,
    block_seq: blockSeq,
    block_type: blockType,
    chunk_seq: chunkSeq,
    byte_length: buf.length,
    captured_bytes: captured.length,
    truncated,
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(taskDir, `${base}.json`), JSON.stringify(meta, null, 2));
}

export function listDebugCaptures({ dir, taskId }: { dir?: string; taskId?: string } = {}): DebugCaptureMeta[] {
  const root = dir ?? debugCaptureRootDir();
  if (!fs.existsSync(root)) return [];

  const taskDirs = taskId
    ? [taskId]
    : fs.readdirSync(root).filter((n) => fs.statSync(path.join(root, n)).isDirectory());
  const out: DebugCaptureMeta[] = [];
  for (const t of taskDirs) {
    const taskDir = path.join(root, t);
    if (!fs.existsSync(taskDir)) continue;
    for (const name of fs.readdirSync(taskDir)) {
      if (!name.endsWith('.json')) continue;
      out.push(JSON.parse(fs.readFileSync(path.join(taskDir, name), 'utf8')) as DebugCaptureMeta);
    }
  }
  out.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return out;
}

interface PurgeArgs {
  dir?: string;
  taskId?: string;
  all?: boolean;
  olderThanDays?: number;
}

export function purgeDebugCaptures({ dir, taskId, all = false, olderThanDays }: PurgeArgs = {}): number {
  const root = dir ?? debugCaptureRootDir();
  if (!taskId && !all) {
    throw new Error('purgeDebugCaptures requires taskId or all:true (refusing to silently no-op)');
  }
  if (!fs.existsSync(root)) return 0;

  const cutoff = olderThanDays != null ? Date.now() - olderThanDays * 24 * 60 * 60 * 1000 : null;
  const candidates = taskId ? [taskId] : fs.readdirSync(root);

  let removed = 0;
  for (const t of candidates) {
    const taskDir = path.join(root, t);
    if (!fs.existsSync(taskDir)) continue;
    if (cutoff != null && fs.statSync(taskDir).mtimeMs > cutoff) continue;
    fs.rmSync(taskDir, { recursive: true, force: true });
    removed++;
  }
  return removed;
}

// --- CLI entry points ---------------------------------------------------

export async function runDebugCaptureList(args: string[]): Promise<void> {
  const opts = parseFlags(args);
  const captures = listDebugCaptures({ taskId: typeof opts.task === 'string' ? opts.task : undefined });
  if (captures.length === 0) {
    console.log('no debug captures found' + (opts.task ? ` for task ${opts.task}` : ''));
    return;
  }
  for (const c of captures) {
    console.log(
      `${c.created_at}  task=${c.task_id}  request#${c.request_index}  block=${c.block_type}#${c.block_seq}  chunk#${c.chunk_seq}  ${c.captured_bytes}/${c.byte_length} bytes${c.truncated ? ' (truncated)' : ''}`
    );
  }
}

export async function runDebugCapturePurge(args: string[]): Promise<void> {
  const opts = parseFlags(args);
  if (!opts.task && !opts.all) {
    console.error('usage: token-profiler debug-capture purge (--task <task_id> | --all) [--older-than-days N]');
    process.exitCode = 1;
    return;
  }
  const olderThanDays = opts['older-than-days'] != null ? Number(opts['older-than-days']) : undefined;
  const removed = purgeDebugCaptures({
    taskId: typeof opts.task === 'string' ? opts.task : undefined,
    all: Boolean(opts.all),
    olderThanDays,
  });
  console.log(`removed ${removed} task capture director${removed === 1 ? 'y' : 'ies'}`);
}

type Flags = Record<string, string | boolean>;

function parseFlags(args: string[]): Flags {
  const opts: Flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) {
      opts[key] = true;
    } else {
      opts[key] = next;
      i++;
    }
  }
  return opts;
}
