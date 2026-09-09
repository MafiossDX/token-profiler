import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

import { MEASUREMENT_PROFILE_V1 } from '../src/core/ingest.ts';
import { ingestBody } from './support.ts';
import {
  openDb,
  openDbReadOnly,
  ensureMeasurementProfile,
  insertTask,
  insertAgent,
  insertRequest,
  endTask,
} from '../src/storage/db.ts';
import {
  createUiServer,
  startUiServer,
  uiClientBuilt,
  UI_DIST,
  UI_NOT_BUILT_MESSAGE,
} from '../src/ui/server.ts';
import { openDb as openDbWritable } from '../src/storage/db.ts';
import type { MessagesRequestBody } from '../src/protocol/anthropic-messages.ts';
import type { TaskMetrics } from '../src/types.ts';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const UI_INDEX = path.join(UI_DIST, 'index.html');

// The server serves the Vite build output (ADR-0015). `npm run check` builds
// before it runs the tests; a bare `npm test` may not have, so build once here.
before(() => {
  if (!uiClientBuilt()) {
    execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
  }
});

function assetFilenames(): { js: string; css: string } {
  const html = fs.readFileSync(UI_INDEX, 'utf8');
  const js = html.match(/assets\/([^"']+\.js)/)?.[1];
  const css = html.match(/assets\/([^"']+\.css)/)?.[1];
  assert.ok(js && css, 'built index.html references a hashed js + css asset');
  return { js: js!, css: css! };
}

// CSV data rows = every line after the header, minus the trailing newline.
function csvDataRows(text: string): string[] {
  return text.replace(/\r\n$/, '').split('\r\n').slice(1).filter((l) => l.length > 0);
}

// The localhost UI (docs/ui-information-design.md §6) must: serve tasks and
// per-task metrics over node:http, refuse anything but GET on known routes,
// and never be able to mutate the profiled DB.

function deterministicFiller(seed: string, byteLength: number): string {
  let out = Buffer.alloc(0);
  let h = crypto.createHash('sha256').update(String(seed)).digest();
  while (out.length < byteLength) {
    out = Buffer.concat([out, Buffer.from(h.toString('hex'))]);
    h = crypto.createHash('sha256').update(h).digest();
  }
  return out.subarray(0, byteLength).toString('utf8');
}

function body(userText: string): MessagesRequestBody {
  return {
    model: 'claude-test',
    system: `you are a helpful coding assistant. ${deterministicFiller('system', 3000)}`,
    tools: [{ name: 'read_file', description: 'reads a file', input_schema: { type: 'object' } }],
    messages: [{ role: 'user', content: userText }],
  };
}

// Build a real on-disk profiler DB with one task, two requests where the
// second fully replays the first (so Context Amplification > 1). The task is
// marked ended unless { running: true } — deleteTask refuses a running task.
function seedDbFile(opts: { running?: boolean } = {}): { dbPath: string; taskId: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttp-ui-'));
  const dbPath = path.join(dir, 'profiler.sqlite');
  const db = openDb(dbPath);
  ensureMeasurementProfile(db, MEASUREMENT_PROFILE_V1);

  const secretHex = crypto.randomBytes(32).toString('hex');
  const fingerprintKeyId = 'test-epoch';
  const taskId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  insertTask(db, {
    taskId,
    createdAt: '2026-08-29T04:28:28.000Z',
    measurementProfileId: MEASUREMENT_PROFILE_V1.id,
    fingerprintKeyId,
  });
  insertAgent(db, { agentId, taskId, agentRole: null, createdAt: '2026-08-29T04:28:28.000Z' });

  const shared = `please read config.json and summarize it. ${deterministicFiller('shared', 4000)}`;
  const reqs = [
    { i: 0, text: shared, inTok: 500, outTok: 50, thread: '2a8', sub: false, cc: 1200, cr: 0 },
    { i: 1, text: shared + '\nalso package.json, new tail.', inTok: 900, outTok: 60, thread: '2a8', sub: false, cc: 40, cr: 5200 },
  ];
  for (const r of reqs) {
    const requestId = crypto.randomUUID();
    insertRequest(db, {
      requestId,
      taskId,
      agentId,
      requestIndex: r.i,
      timestamp: `2026-08-29T04:2${r.i}:00.000Z`,
      model: 'claude-test',
      provider: 'anthropic',
      providerReportedInputTokens: r.inTok,
      providerReportedOutputTokens: r.outTok,
      cacheCreationInputTokens: r.cc,
      cacheReadInputTokens: r.cr,
      threadExternalId: r.thread,
      isSubagent: r.sub,
    });
    ingestBody(db, { requestId, requestIndex: r.i, requestBody: body(r.text), secretHex, fingerprintKeyId });
  }
  if (!opts.running) endTask(db, taskId, '2026-08-29T04:36:48.000Z');
  db.close();
  return { dbPath, taskId };
}

async function withServer(dbPath: string, fn: (base: string) => Promise<void>): Promise<void> {
  const db = openDbReadOnly(dbPath);
  const server = createUiServer(db, dbPath);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
}

test('GET /api/tasks lists the seeded task with a request count', async () => {
  const { dbPath, taskId } = seedDbFile();
  await withServer(dbPath, async (base) => {
    const res = await fetch(`${base}/api/tasks`);
    assert.equal(res.status, 200);
    const list = (await res.json()) as Array<{ taskId: string; requestCount: number; contextAmplification: number | null }>;
    const row = list.find((t) => t.taskId === taskId);
    assert.ok(row, 'seeded task present in /api/tasks');
    assert.equal(row.requestCount, 2);
    assert.ok((row.contextAmplification ?? 0) > 1, 'amplification computed for the list row');
  });
});

test('GET /api/tasks/:id returns computeTaskMetrics output incl. requestRows', async () => {
  const { dbPath, taskId } = seedDbFile();
  await withServer(dbPath, async (base) => {
    const res = await fetch(`${base}/api/tasks/${taskId}`);
    assert.equal(res.status, 200);
    const m = (await res.json()) as TaskMetrics;
    assert.equal(m.taskId, taskId);
    assert.equal(m.basis, 'byte');
    assert.ok((m.contextAmplification ?? 0) > 1);
    assert.equal(m.requestRows.length, 2);
    assert.deepEqual(
      m.requestRows.map((r) => r.requestIndex),
      [0, 1]
    );
    assert.equal(m.requestRows[0].threadExternalId, '2a8');
    assert.equal(m.requestRows[1].cacheReadInputTokens, 5200);
    // per-request class byte sums + exact reuse ratio (Requests table / exports)
    assert.ok(m.requestRows[0].applicationBytes > 0, 'row has application bytes');
    assert.ok(m.requestRows[0].protocolBytes > 0, 'row has protocol bytes');
    assert.equal(
      m.requestRows[0].applicationBytes + m.requestRows[0].protocolBytes + m.requestRows[0].unknownBytes >
        0,
      true
    );
    assert.ok((m.requestRows[1].exactReuseRatio ?? 0) > 0, 'row 1 replays row 0 → reuse ratio > 0');
  });
});

test('unknown task id → 404, unknown route → 404, non-GET → 405', async () => {
  const { dbPath } = seedDbFile();
  await withServer(dbPath, async (base) => {
    assert.equal((await fetch(`${base}/api/tasks/does-not-exist`)).status, 404);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(`${base}/api/tasks`, { method: 'POST' })).status, 405);
  });
});

test('GET / serves the built client shell referencing a hashed JS + CSS asset', async () => {
  const { dbPath } = seedDbFile();
  await withServer(dbPath, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const html = await res.text();
    assert.match(html, /token-profiler/);
    assert.match(html, /<div id="app">/);
    assert.match(html, /assets\/[^"']+\.js/);
  });
});

test('GET /assets/<hashed file> serves the bundle with an immutable long cache', async () => {
  const { dbPath } = seedDbFile();
  const { js, css } = assetFilenames();
  await withServer(dbPath, async (base) => {
    const jsRes = await fetch(`${base}/assets/${js}`);
    assert.equal(jsRes.status, 200);
    assert.match(jsRes.headers.get('content-type') ?? '', /javascript/);
    assert.match(jsRes.headers.get('cache-control') ?? '', /immutable/);

    const cssRes = await fetch(`${base}/assets/${css}`);
    assert.equal(cssRes.status, 200);
    assert.match(cssRes.headers.get('content-type') ?? '', /text\/css/);
  });
});

// ADR-0016 lets the client lead with a diagnostic reading (reference zones,
// Next focus, the duplicate-context ranking), but the vocabulary it still
// forbids — Hotspots-style enumeration, cause assertions, value words, a
// synthetic health score — must not be in the shipped bundle. ADR-0017 also
// drops the OK/Watch/Warning/Critical verdict words from the zone labels.
// Panel labels live in the bundle, not index.html.
test('shipped client bundle: diagnostic panels present, no forbidden vocabulary', async () => {
  const { dbPath } = seedDbFile();
  const { js } = assetFilenames();
  await withServer(dbPath, async (base) => {
    const bundle = await (await fetch(`${base}/assets/${js}`)).text();
    assert.match(bundle, /Current amplification/);
    assert.match(bundle, /Next focus/);
    assert.match(bundle, /request 調査/);
    assert.doesNotMatch(bundle, /Hotspots/);
    assert.doesNotMatch(bundle, /構造的に支配的/);
    assert.doesNotMatch(bundle, /health score/i);
    // ADR-0017: reference-zone labels are plain ratio ranges now.
    assert.doesNotMatch(bundle, /\b(Critical|Warning|Watch)\b/);
  });
});

test('asset route: unknown file, `..` traversal, and non-file all 404', async () => {
  const { dbPath } = seedDbFile();
  await withServer(dbPath, async (base) => {
    assert.equal((await fetch(`${base}/assets/nope-does-not-exist.js`)).status, 404);
    // `%2e%2e%2f` keeps the `..` out of URL normalisation so it reaches the
    // asset route; basename() + realpath containment still reject it.
    assert.equal((await fetch(`${base}/assets/%2e%2e%2fserver.ts`)).status, 404);
    assert.equal((await fetch(`${base}/assets/%2e%2e%2f%2e%2e%2fpackage.json`)).status, 404);
    assert.equal((await fetch(`${base}/assets/`)).status, 404);
  });
});

test('asset route: a symlink pointing outside dist/ui/assets is refused', async (t) => {
  const { dbPath } = seedDbFile();
  const assetsDir = path.join(UI_DIST, 'assets');
  const outside = path.join(os.tmpdir(), `ttp-outside-${crypto.randomUUID()}.txt`);
  fs.writeFileSync(outside, 'secret');
  const link = path.join(assetsDir, 'escape.txt');
  try {
    fs.symlinkSync(outside, link);
  } catch {
    fs.rmSync(outside, { force: true });
    t.skip('symlink creation not permitted on this platform');
    return;
  }
  t.after(() => {
    fs.rmSync(link, { force: true });
    fs.rmSync(outside, { force: true });
  });
  await withServer(dbPath, async (base) => {
    assert.equal((await fetch(`${base}/assets/escape.txt`)).status, 404);
  });
});

// ADR-0015 decision 5: a source checkout with no `npm run build` has no client
// to serve. `ui` (via startUiServer) fails fast; `wrap` shares this same
// uiClientBuilt() gate to degrade to --no-ui.
test('startUiServer rejects when dist/ui/index.html is absent', async () => {
  const bak = UI_INDEX + '.bak';
  fs.renameSync(UI_INDEX, bak);
  try {
    assert.equal(uiClientBuilt(), false);
    await assert.rejects(startUiServer({ port: 0 }), (err: Error) => {
      assert.equal(err.message, UI_NOT_BUILT_MESSAGE);
      return true;
    });
  } finally {
    fs.renameSync(bak, UI_INDEX);
  }
  assert.equal(uiClientBuilt(), true);
});

test('export.json carries filter metadata and scopes rows by ?thread=', async () => {
  const { dbPath, taskId } = seedDbFile();
  await withServer(dbPath, async (base) => {
    const res = await fetch(`${base}/api/tasks/${taskId}/export.json`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename=".*metrics\.json"/);
    const payload = (await res.json()) as {
      metrics: TaskMetrics;
      generatedAt: string;
      filter: { thread: string | null; contextClass: string | null };
      filterAppliedTo: string[];
    };
    assert.equal(payload.metrics.taskId, taskId);
    assert.ok((payload.metrics.contextAmplification ?? 0) > 1);
    assert.equal(payload.metrics.requestRows.length, 2);
    assert.deepEqual(payload.filter, { thread: null, contextClass: null });
    assert.deepEqual(payload.filterAppliedTo, []);

    const scoped = (await (
      await fetch(`${base}/api/tasks/${taskId}/export.json?thread=2a8`)
    ).json()) as typeof payload;
    assert.equal(scoped.filter.thread, '2a8');
    assert.ok(scoped.filterAppliedTo.includes('requestRows'));
    assert.ok(scoped.filterAppliedTo.includes('threadBreakdown'));
    assert.ok(scoped.metrics.requestRows.every((r) => r.threadExternalId === '2a8'));
    // scalar Core Measurements stay task-level even when filtered
    assert.equal(scoped.metrics.contextAmplification, payload.metrics.contextAmplification);

    const ctx = (await (
      await fetch(`${base}/api/tasks/${taskId}/export.json?context_class=protocol`)
    ).json()) as typeof payload;
    assert.equal(ctx.filter.contextClass, 'protocol');
    assert.deepEqual(ctx.filterAppliedTo, []); // block-level attr, not applied here
    assert.equal(ctx.metrics.requestRows.length, 2);
  });
});

test('requests.csv / .jsonl export raw request rows and honour ?thread=', async () => {
  const { dbPath, taskId } = seedDbFile();
  await withServer(dbPath, async (base) => {
    const csv = await fetch(`${base}/api/tasks/${taskId}/requests.csv`);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
    const csvText = await csv.text();
    const header = csvText.split('\r\n')[0];
    assert.match(header, /^requestIndex,timestamp,model,/);
    assert.match(header, /applicationBytes,protocolBytes,unknownBytes,exactReuseRatio/);
    assert.equal(csvDataRows(csvText).length, 2);

    const scoped = await (await fetch(`${base}/api/tasks/${taskId}/requests.csv?thread=2a8`)).text();
    assert.equal(csvDataRows(scoped).length, 2);
    const empty = await (await fetch(`${base}/api/tasks/${taskId}/requests.csv?thread=zzz`)).text();
    assert.equal(csvDataRows(empty).length, 0);

    const jsonl = await (await fetch(`${base}/api/tasks/${taskId}/requests.jsonl`)).text();
    const lines = jsonl.trimEnd().split('\n');
    assert.equal(lines.length, 2);
    assert.equal((JSON.parse(lines[0]) as { requestIndex: number }).requestIndex, 0);
  });
});

test('threads.csv exports the thread breakdown', async () => {
  const { dbPath, taskId } = seedDbFile();
  await withServer(dbPath, async (base) => {
    const text = await (await fetch(`${base}/api/tasks/${taskId}/threads.csv`)).text();
    assert.match(text.split('\r\n')[0], /^threadExternalId,isSubagent,requestCount,/);
    const rows = csvDataRows(text);
    assert.equal(rows.length, 1);
    assert.match(rows[0], /^2a8,/);
  });
});

test('blocks.csv exports StructuralBlock rows and ?context_class= scopes them', async () => {
  const { dbPath, taskId } = seedDbFile();
  await withServer(dbPath, async (base) => {
    const all = csvDataRows(await (await fetch(`${base}/api/tasks/${taskId}/blocks.csv`)).text());
    assert.ok(all.length > 0);

    const app = csvDataRows(
      await (await fetch(`${base}/api/tasks/${taskId}/blocks.csv?context_class=application`)).text()
    );
    const proto = csvDataRows(
      await (await fetch(`${base}/api/tasks/${taskId}/blocks.csv?context_class=protocol`)).text()
    );
    assert.ok(app.length > 0, 'has application blocks');
    assert.ok(proto.length > 0, 'has protocol blocks');
    assert.ok(app.length + proto.length <= all.length);
    assert.ok(app.every((r) => r.split(',')[4] === 'application'));

    const none = csvDataRows(
      await (await fetch(`${base}/api/tasks/${taskId}/blocks.csv?context_class=bogus`)).text()
    );
    assert.equal(none.length, 0);
  });
});

test('export routes 404 on an unknown task id', async () => {
  const { dbPath } = seedDbFile();
  await withServer(dbPath, async (base) => {
    for (const kind of ['export.json', 'requests.csv', 'requests.jsonl', 'threads.csv', 'blocks.csv']) {
      assert.equal((await fetch(`${base}/api/tasks/nope/${kind}`)).status, 404, kind);
    }
  });
});

test('read-only UI server runs against a DB that has an open writable handle (wrap piggyback)', async () => {
  const { dbPath, taskId } = seedDbFile();
  // `wrap` keeps a writable WAL handle open for the whole session; the
  // piggybacked UI opens the same file read-only alongside it.
  const writer = openDbWritable(dbPath);
  try {
    await withServer(dbPath, async (base) => {
      const list = (await (await fetch(`${base}/api/tasks`)).json()) as Array<{ taskId: string }>;
      assert.ok(list.some((t) => t.taskId === taskId));
      assert.equal((await fetch(`${base}/api/tasks/${taskId}`)).status, 200);
    });
  } finally {
    writer.close();
  }
});

test('openDbReadOnly refuses writes to the profiled DB', () => {
  const { dbPath } = seedDbFile();
  const ro = openDbReadOnly(dbPath);
  try {
    assert.throws(
      () => ro.exec(`INSERT INTO agents (agent_id, task_id, agent_role, created_at) VALUES ('x','y',NULL,'z')`),
      /readonly|read-only|read only/i
    );
  } finally {
    ro.close();
  }
});

test('openDbReadOnly throws a helpful error when the DB file is absent', () => {
  const missing = path.join(os.tmpdir(), `ttp-missing-${crypto.randomUUID()}.sqlite`);
  assert.throws(() => openDbReadOnly(missing), /no profiler database/);
});

// ---- task deletion (ADR-0014: local data lifecycle, confirmation-gated) ----

test('POST /api/tasks/:id/delete removes the task and its owned rows', async () => {
  const { dbPath, taskId } = seedDbFile();
  await withServer(dbPath, async (base) => {
    const res = await fetch(`${base}/api/tasks/${taskId}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmTaskId: taskId }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, taskId, deletedRequests: 2 });

    const list = (await (await fetch(`${base}/api/tasks`)).json()) as Array<{ taskId: string }>;
    assert.ok(!list.some((t) => t.taskId === taskId), 'task gone from /api/tasks');
    assert.equal((await fetch(`${base}/api/tasks/${taskId}`)).status, 404);
  });
  // owned rows are gone, not just the tasks row
  const ro = openDbReadOnly(dbPath);
  try {
    for (const table of ['requests', 'agents', 'structural_blocks', 'content_chunks']) {
      const n = (ro.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
      assert.equal(n, 0, `${table} emptied`);
    }
  } finally {
    ro.close();
  }
});

test('delete refuses a mismatched confirmTaskId and keeps the task', async () => {
  const { dbPath, taskId } = seedDbFile();
  await withServer(dbPath, async (base) => {
    const res = await fetch(`${base}/api/tasks/${taskId}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmTaskId: 'not-the-id' }),
    });
    assert.equal(res.status, 400);
    assert.equal((await fetch(`${base}/api/tasks/${taskId}`)).status, 200);
  });
});

test('delete refuses a still-running task with 409', async () => {
  const { dbPath, taskId } = seedDbFile({ running: true });
  await withServer(dbPath, async (base) => {
    const res = await fetch(`${base}/api/tasks/${taskId}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmTaskId: taskId }),
    });
    assert.equal(res.status, 409);
    assert.match(((await res.json()) as { error: string }).error, /running/);
    assert.equal((await fetch(`${base}/api/tasks/${taskId}`)).status, 200);
  });
});

test('delete with force:true removes a still-running task', async () => {
  const { dbPath, taskId } = seedDbFile({ running: true });
  await withServer(dbPath, async (base) => {
    const res = await fetch(`${base}/api/tasks/${taskId}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmTaskId: taskId, force: true }),
    });
    assert.equal(res.status, 200);
    assert.equal((await fetch(`${base}/api/tasks/${taskId}`)).status, 404);
  });
});

test('delete on an unknown task id → 404', async () => {
  const { dbPath } = seedDbFile();
  await withServer(dbPath, async (base) => {
    const res = await fetch(`${base}/api/tasks/nope/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmTaskId: 'nope' }),
    });
    assert.equal(res.status, 404);
  });
});

test('delete route answers 403 on a server started without a dbPath (read-only)', async () => {
  const { dbPath, taskId } = seedDbFile();
  const db = openDbReadOnly(dbPath);
  const server = createUiServer(db); // no dbPath → no write path
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/tasks/${taskId}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmTaskId: taskId }),
    });
    assert.equal(res.status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/tasks/${taskId}`)).status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test('shipped client: `local data` badge (not read-only), single-column panels, delete control', async () => {
  const { dbPath } = seedDbFile();
  const { js, css } = assetFilenames();
  await withServer(dbPath, async (base) => {
    const bundle = await (await fetch(`${base}/assets/${js}`)).text();
    assert.doesNotMatch(bundle, /read-only/);
    assert.match(bundle, /local data/);
    assert.match(bundle, /task-del/); // per-task delete control

    const style = await (await fetch(`${base}/assets/${css}`)).text();
    // Timeline + Request detail pair up (`.two-col`); no page-length sticky
    // sidebar (ADR-0016 — the old `.cols > .right { position: sticky }` got in
    // the way of the panels above/below it).
    assert.match(style, /\.two-col\s*\{/);
    assert.doesNotMatch(style, /position:\s*sticky/);
  });
});
