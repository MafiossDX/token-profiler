import type { TaskMetrics, RequestRow, TaskListItem } from '../api.ts';

// One task, two threads, three request rows with distinct input-token counts so
// a sort is observable. Mirrors the pre-Preact client test fixture.
export function mkRow(
  requestIndex: number,
  threadExternalId: string,
  inTok: number,
  outTok: number,
  exactReuseRatio: number
): RequestRow {
  return {
    requestIndex,
    timestamp: `2026-08-29T04:2${requestIndex}:00.000Z`,
    threadExternalId,
    isSubagent: threadExternalId === '915',
    model: 'claude-test',
    operationType: 'message',
    providerReportedInputTokens: inTok,
    providerReportedOutputTokens: outTok,
    cacheCreationInputTokens: 40,
    cacheReadInputTokens: 5200,
    latencyMs: 1200 + requestIndex,
    applicationBytes: inTok * 4,
    protocolBytes: 800,
    unknownBytes: 0,
    exactReuseRatio,
  };
}

function thread(
  threadExternalId: string,
  isSubagent: boolean,
  requestCount: number,
  firstRequestIndex: number
): TaskMetrics['threadBreakdown'][number] {
  return {
    threadExternalId,
    isSubagent,
    requestCount,
    inputTokens: 1000 * requestCount,
    outputTokens: 20 * requestCount,
    cacheCreationTokens: 40,
    cacheReadTokens: 5200,
    firstRequestIndex,
  };
}

export interface Fixture {
  taskId: string;
  listItem: TaskListItem;
  metrics: TaskMetrics;
}

export function fixture(): Fixture {
  return { taskId: 'task-fixture-1', ...fixtureFor('task-fixture-1', 3.14) };
}

// Same shape as fixture() for an arbitrary task id, with a caller-chosen
// contextAmplification so a test can tell task A's render from task B's.
export function fixtureFor(
  taskId: string,
  contextAmplification: number
): { listItem: TaskListItem; metrics: TaskMetrics } {
  const requestRows = [
    mkRow(0, '2a8', 500, 10, 0.0),
    mkRow(1, '915', 1500, 20, 0.4),
    mkRow(2, '2a8', 900, 30, 0.7),
  ];
  const metrics: TaskMetrics = {
    taskId,
    basis: 'byte',
    ucv: 4000,
    ctv: 12560,
    contextAmplification,
    classificationCoverage: 0.998,
    protocolShare: 0.156,
    transportByClass: { application: 8000, protocol: 1500, unknown: 100 },
    totalTransport: 9600,
    threadBreakdown: [thread('2a8', false, 2, 0), thread('915', true, 1, 1)],
    requestRows,
    exactReuseByRequest: requestRows.map((r) => ({
      requestId: 'r' + r.requestIndex,
      requestIndex: r.requestIndex,
      exactReuseRatio: r.exactReuseRatio,
      reusedBytes: Math.round(r.applicationBytes * (r.exactReuseRatio ?? 0)),
      totalBytes: r.applicationBytes,
    })),
    observedTokenTraffic: {
      inputTokens: 2900,
      outputTokens: 60,
      cacheCreationTokens: 1200,
      cacheReadTokens: 5200,
      requestCount: 3,
    },
  };
  const listItem: TaskListItem = {
    taskId,
    createdAt: '2026-08-29T04:20:00.000Z',
    endedAt: '2026-08-29T04:36:48.000Z',
    requestCount: 3,
    contextAmplification,
  };
  return { listItem, metrics };
}

// `count` request rows, all in one thread, except request #0 which carries
// the largest duplicate-context volume (so `topReq` / Next focus point at
// it). Used by pagination tests that need enough rows to span several pages
// — `mkRow`'s minute-based timestamp only fits single-digit indices, so rows
// here vary by second instead (`count` must stay <= 60).
export function manyRowsFixture(
  taskId: string,
  count: number
): { listItem: TaskListItem; metrics: TaskMetrics } {
  const requestRows: RequestRow[] = [];
  for (let i = 0; i < count; i++) {
    const reuse = i === 0 ? 0.9 : 0.1;
    requestRows.push({
      requestIndex: i,
      timestamp: `2026-08-29T04:20:${String(i).padStart(2, '0')}.000Z`,
      threadExternalId: 'many',
      isSubagent: false,
      model: 'claude-test',
      operationType: 'message',
      providerReportedInputTokens: 1000,
      providerReportedOutputTokens: 10,
      cacheCreationInputTokens: 40,
      cacheReadInputTokens: 5200,
      latencyMs: 1200 + i,
      applicationBytes: 4000,
      protocolBytes: 800,
      unknownBytes: 0,
      exactReuseRatio: reuse,
    });
  }
  const metrics: TaskMetrics = {
    taskId,
    basis: 'byte',
    ucv: 4000,
    ctv: 12560,
    contextAmplification: 3.14,
    classificationCoverage: 0.998,
    protocolShare: 0.156,
    transportByClass: { application: 8000, protocol: 1500, unknown: 100 },
    totalTransport: 9600,
    threadBreakdown: [thread('many', false, count, 0)],
    requestRows,
    exactReuseByRequest: requestRows.map((r) => ({
      requestId: 'r' + r.requestIndex,
      requestIndex: r.requestIndex,
      exactReuseRatio: r.exactReuseRatio,
      reusedBytes: Math.round(r.applicationBytes * (r.exactReuseRatio ?? 0)),
      totalBytes: r.applicationBytes,
    })),
    observedTokenTraffic: {
      inputTokens: 1000 * count,
      outputTokens: 10 * count,
      cacheCreationTokens: 40 * count,
      cacheReadTokens: 5200 * count,
      requestCount: count,
    },
  };
  const listItem: TaskListItem = {
    taskId,
    createdAt: '2026-08-29T04:20:00.000Z',
    endedAt: '2026-08-29T04:36:48.000Z',
    requestCount: count,
    contextAmplification: 3.14,
  };
  return { listItem, metrics };
}

// A `fetch` stand-in over the UI server's read routes: /api/tasks and
// /api/tasks/:id. Records calls as "METHOD path?search". `metricsGate`, if
// given, is awaited before a /api/tasks/:id response resolves — a test uses it
// to hold or reorder detail responses.
export function makeFetch(opts: {
  tasks?: unknown[];
  metrics?: Record<string, unknown>;
  calls?: string[];
  metricsGate?: (taskId: string) => Promise<unknown>;
}): typeof fetch {
  const tasks = opts.tasks ?? [];
  const metrics = opts.metrics ?? {};
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input), 'http://localhost');
    opts.calls?.push(`${init?.method ?? 'GET'} ${u.pathname}${u.search}`);
    const json = (body: unknown, status = 200): Response =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
        headers: new Headers(),
      }) as unknown as Response;

    if (u.pathname === '/api/tasks') return json(tasks);
    const md = u.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (md) {
      const taskId = decodeURIComponent(md[1]);
      if (opts.metricsGate) await opts.metricsGate(taskId);
      const m = metrics[taskId];
      return m ? json(m) : json({ error: 'not found' }, 404);
    }
    return json({ error: 'not found' }, 404);
  }) as typeof fetch;
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
