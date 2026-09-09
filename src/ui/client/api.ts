// Thin client for the localhost UI's own server (src/ui/server.ts). Every
// number it returns comes from computeTaskMetrics() server-side — the client
// never recomputes a Core Measurement, only formats and filters.

import type { TaskMetrics } from '../../types.ts';

export type { TaskMetrics } from '../../types.ts';
export type { RequestRow, ThreadBreakdownRow } from '../../types.ts';

// Row shape of GET /api/tasks (server.ts `TaskListItem` — kept in sync by hand;
// importing from server.ts would pull its node:http type graph into the client
// type-check).
export interface TaskListItem {
  taskId: string;
  createdAt: string;
  endedAt: string | null;
  requestCount: number;
  contextAmplification: number | null;
}

export async function fetchTasks(): Promise<TaskListItem[]> {
  const res = await fetch('/api/tasks');
  if (!res.ok) throw new Error(`GET /api/tasks → ${res.status}`);
  return (await res.json()) as TaskListItem[];
}

export interface MetricsResult {
  // The task this result is for — callers compare it against the current
  // selection before rendering, so a slow / out-of-order response for a
  // now-deselected task cannot overwrite the visible detail.
  taskId: string;
  ok: boolean;
  // HTTP status, or 0 when the request never completed (network / transport).
  // The caller treats 404 as "task is gone" (show the error) and any other
  // non-ok as transient (keep the last good view, flag it stale).
  status: number;
  metrics: TaskMetrics | null;
  error: string | null;
}

// Never rejects — a network failure comes back as { ok: false, status: 0 } so
// callers have one code path for "no fresh data this time".
export async function fetchMetrics(taskId: string): Promise<MetricsResult> {
  let res: Response;
  try {
    res = await fetch('/api/tasks/' + encodeURIComponent(taskId));
  } catch (err) {
    return { taskId, ok: false, status: 0, metrics: null, error: String(err) };
  }
  if (!res.ok) {
    let error = 'not found';
    try {
      error = ((await res.json()) as { error?: string }).error ?? error;
    } catch {
      /* keep default */
    }
    return { taskId, ok: false, status: res.status, metrics: null, error };
  }
  try {
    return {
      taskId,
      ok: true,
      status: res.status,
      metrics: (await res.json()) as TaskMetrics,
      error: null,
    };
  } catch (err) {
    return { taskId, ok: false, status: res.status, metrics: null, error: String(err) };
  }
}

export interface DeleteResult {
  ok: boolean;
  error: string | null;
}

export async function deleteTask(
  taskId: string,
  opts: { force?: boolean } = {}
): Promise<DeleteResult> {
  let res: Response;
  try {
    res = await fetch('/api/tasks/' + encodeURIComponent(taskId) + '/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmTaskId: taskId, force: opts.force === true }),
    });
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  if (!res.ok) {
    const msg = await res
      .json()
      .then((j: { error?: string }) => j.error ?? res.statusText)
      .catch(() => res.statusText);
    return { ok: false, error: msg };
  }
  return { ok: true, error: null };
}
