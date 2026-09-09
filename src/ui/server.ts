import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';

import { openDbReadOnly, openDbReadWrite, deleteTask, defaultDbPath } from '../storage/db.ts';
import { computeTaskMetrics, computeContextAmplificationForAllTasks } from '../core/metrics.ts';
import { buildExport, type ExportKind } from './export.ts';

// Localhost view of profiler.sqlite (docs/ui-information-design.md). node:http
// only, bound to 127.0.0.1. Every number it serves comes from
// computeTaskMetrics() — the same code `report` uses — so the UI can never
// disagree with the CLI, except the task list's contextAmplification column,
// which uses computeContextAmplificationForAllTasks() (same UCV/CTV formula,
// batched across every task so the list doesn't pay for per-task exact-reuse
// / thread-breakdown / request-rows work it never displays). The only
// mutation it exposes is explicit, confirmed task deletion (ADR-0014); all
// reads go through a read-only handle.
//
// The client is a Preact app built by Vite (ADR-0015). This server only serves
// the build output in `dist/ui/`: `/` → `dist/ui/index.html`, `/assets/<file>`
// → `dist/ui/assets/<file>`. `dist/ui/` is not version-controlled — a source
// checkout runs `npm run build` (or `vite build --watch`) to produce it; a
// release tarball always ships it. Absence is handled by the callers
// (`wrap` degrades to --no-ui, `ui` fails fast) via uiClientBuilt().

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Vite build output (ADR-0015). Exported so tests can locate / temporarily
// hide it; runtime code should go through uiClientBuilt().
export const UI_DIST = path.resolve(__dirname, '../../dist/ui');
const INDEX_HTML = path.join(UI_DIST, 'index.html');
const ASSETS_DIR = path.join(UI_DIST, 'assets');

export const UI_NOT_BUILT_MESSAGE =
  "[token-profiler] ui not built — run 'npm run build' (source checkout only)";

// True when the Vite build output is present. Callers check this before
// starting the UI (ADR-0015 decision 5).
export function uiClientBuilt(): boolean {
  return fs.existsSync(INDEX_HTML);
}

const ASSET_CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// GET /assets/<file>. The only path arithmetic the server does: take the
// basename (drops any `..` / nested segments), resolve it inside ASSETS_DIR,
// then require the realpath to stay within the realpath of ASSETS_DIR so a
// symlink cannot escape (ADR-0015 decision 6). Anything off the path, or a
// non-file, is a 404 — same as an unknown asset.
function serveAsset(rawName: string, res: http.ServerResponse): void {
  const name = path.basename(rawName);
  if (!name || name === '.' || name === '..') {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  const candidate = path.resolve(ASSETS_DIR, name);
  let real: string;
  let realDir: string;
  try {
    realDir = fs.realpathSync(ASSETS_DIR);
    real = fs.realpathSync(candidate);
  } catch {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  if (real !== realDir && !real.startsWith(realDir + path.sep)) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  let buf: Buffer;
  try {
    if (!fs.statSync(real).isFile()) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    buf = fs.readFileSync(real);
  } catch {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  res.writeHead(200, {
    'content-type': ASSET_CONTENT_TYPES[path.extname(real).toLowerCase()] ?? 'application/octet-stream',
    'content-length': String(buf.length),
    // Vite emits content-hashed filenames — safe to cache hard.
    'cache-control': 'public, max-age=31536000, immutable',
  });
  res.end(buf);
}

export interface UiServerOptions {
  port?: number;
  dbPath?: string;
}

interface TaskListItem {
  taskId: string;
  createdAt: string;
  endedAt: string | null;
  requestCount: number;
  contextAmplification: number | null;
}

function listTasks(db: DatabaseSync): TaskListItem[] {
  const rows = db
    .prepare(
      `SELECT t.task_id AS task_id, t.created_at AS created_at, t.ended_at AS ended_at,
              COUNT(r.request_id) AS request_count
       FROM tasks t
       LEFT JOIN requests r ON r.task_id = t.task_id
       GROUP BY t.task_id
       ORDER BY t.created_at DESC`
    )
    .all() as unknown as Array<{
    task_id: string;
    created_at: string;
    ended_at: string | null;
    request_count: number;
  }>;

  const amplificationByTask = computeContextAmplificationForAllTasks(db);

  return rows.map((r) => ({
    taskId: r.task_id,
    createdAt: r.created_at,
    endedAt: r.ended_at,
    requestCount: r.request_count,
    contextAmplification: amplificationByTask.get(r.task_id) ?? null,
  }));
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(buf.length),
    'cache-control': 'no-store',
  });
  res.end(buf);
}

function readBody(req: http.IncomingMessage, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => {
      data += c;
      if (data.length > limit) reject(new Error('request body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// POST /api/tasks/:id/delete  { confirmTaskId: "<id>" }
// The UI's one write path (ADR-0014): explicit, confirmed local data deletion.
// Enabled only when the server knows the DB file path (dbPath). confirmTaskId
// must equal the id in the URL exactly, and deleteTask() itself refuses a Task
// whose ended_at IS NULL.
async function handleDelete(
  dbPath: string,
  taskId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  let parsed: { confirmTaskId?: unknown; force?: unknown };
  try {
    parsed = JSON.parse((await readBody(req)) || '{}') as {
      confirmTaskId?: unknown;
      force?: unknown;
    };
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' });
    return;
  }
  if (parsed.confirmTaskId !== taskId) {
    sendJson(res, 400, { error: 'confirmTaskId must match the task id in the URL' });
    return;
  }
  const wdb = openDbReadWrite(dbPath);
  try {
    const { deletedRequests } = deleteTask(wdb, taskId, { force: parsed.force === true });
    sendJson(res, 200, { ok: true, taskId, deletedRequests });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /still running/.test(msg) ? 409 : /unknown task/.test(msg) ? 404 : 500;
    sendJson(res, status, { error: msg });
  } finally {
    wdb.close();
  }
}

function handle(
  db: DatabaseSync,
  dbPath: string | null,
  req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  if (req.method === 'POST') {
    const del = url.pathname.match(/^\/api\/tasks\/([^/]+)\/delete$/);
    if (del && dbPath) {
      handleDelete(dbPath, decodeURIComponent(del[1]), req, res).catch((err) => {
        // handleDelete owns its own error responses; this only catches a throw
        // before one was sent (e.g. openDbReadWrite failing, socket error).
        if (!res.headersSent) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        } else {
          res.end();
        }
      });
      return;
    }
    sendJson(res, del ? 403 : 405, { error: del ? 'delete not available' : 'method not allowed' });
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  if (url.pathname === '/') {
    let html: Buffer;
    try {
      html = fs.readFileSync(INDEX_HTML);
    } catch {
      // Should not happen — callers gate on uiClientBuilt() before starting.
      sendJson(res, 503, { error: 'ui client not built' });
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(html.length),
      'cache-control': 'no-store',
    });
    res.end(html);
    return;
  }

  const asset = url.pathname.match(/^\/assets\/(.+)$/);
  if (asset) {
    serveAsset(decodeURIComponent(asset[1]), res);
    return;
  }

  if (url.pathname === '/api/tasks') {
    sendJson(res, 200, listTasks(db));
    return;
  }

  const detail = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (detail) {
    const taskId = decodeURIComponent(detail[1]);
    try {
      sendJson(res, 200, computeTaskMetrics(db, taskId));
    } catch (err) {
      sendJson(res, 404, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // Raw-data export (docs/ui-information-design.md §3.5). Still read-only:
  // a GET that streams stored rows out as CSV / JSON Lines / metrics JSON,
  // optionally scoped to the UI's current thread / context_class filter.
  const exp = url.pathname.match(
    /^\/api\/tasks\/([^/]+)\/(export\.json|requests\.csv|requests\.jsonl|threads\.csv|blocks\.csv)$/
  );
  if (exp) {
    const taskId = decodeURIComponent(exp[1]);
    const kind = exp[2] as ExportKind;
    try {
      const { body, contentType, filename } = buildExport(db, taskId, kind, {
        thread: url.searchParams.get('thread'),
        contextClass: url.searchParams.get('context_class'),
      });
      const buf = Buffer.from(body);
      res.writeHead(200, {
        'content-type': contentType,
        'content-length': String(buf.length),
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      });
      res.end(buf);
    } catch (err) {
      sendJson(res, 404, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

// dbPath enables the one write route (POST …/delete). Omit it (or pass null)
// for a strictly read-only server — the delete route then answers 403.
export function createUiServer(db: DatabaseSync, dbPath: string | null = null): http.Server {
  return http.createServer((req, res) => {
    try {
      handle(db, dbPath, req, res);
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } else {
        res.end();
      }
    }
  });
}

export async function startUiServer(opts: UiServerOptions = {}): Promise<void> {
  // Fail fast on a source checkout that has not run `npm run build`
  // (ADR-0015 decision 5). A release tarball always ships dist/ui/.
  if (!uiClientBuilt()) {
    throw new Error(UI_NOT_BUILT_MESSAGE);
  }
  const port = opts.port ?? 7331;
  const dbPath = opts.dbPath ?? defaultDbPath();
  const db = openDbReadOnly(dbPath);
  const server = createUiServer(db, dbPath);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      console.log(`token-profiler ui  →  http://127.0.0.1:${port}/   (Ctrl+C to stop)`);
      resolve();
    });
  });

  const shutdown = (): void => {
    server.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
