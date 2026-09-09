import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import { fetchTasks, fetchMetrics, type TaskListItem, type MetricsResult } from './api.ts';
import { readUrl, writeUrl, type UiState, type FilterMode } from './urlState.ts';
import { threadKeyOfBreakdown } from './filter.ts';
import { nowClock } from './format.ts';
import { Header } from './components/Header.tsx';
import { TaskList } from './components/TaskList.tsx';
import { Detail } from './components/Detail.tsx';
import type { ReqSort } from './components/RequestExplorer.tsx';

const POLL_MS = 5000;
// request 調査 defaults to duplicate-context bytes, descending (ADR-0016 §3.7; ADR-0018).
const DEFAULT_SORT: ReqSort = { key: 'dupBytes', dir: -1 };

// Top-level app. The pre-Preact client kept view state (selection, sort) in
// module-level globals so a 5 s poll re-render would not wipe it (ADR-0014
// consequence). With component state + vdom diffing that hazard is gone —
// `ui` / `reqSort` are ordinary state and the poll just refreshes `tasks` /
// `detail` in place.
export function App(): ComponentChildren {
  const [ui, setUi] = useState<UiState>(() => readUrl());
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [detail, setDetail] = useState<MetricsResult | null>(null);
  const [reqSort, setReqSort] = useState<ReqSort>(DEFAULT_SORT);
  const [selectedRequest, setSelectedRequest] = useState<number | null>(null);
  // Bumped on every explicit onSelectRequest call, even a reselection of the
  // same requestIndex (code review: "同じ request の再選択では、対象ページへ
  // 移動しません" — `selected`'s *value* not changing must not stop
  // RequestExplorer's page-follow effect from re-firing).
  const [selectSeq, setSelectSeq] = useState<number>(0);
  const [updatedAt, setUpdatedAt] = useState<string>('—');
  // A poll that threw (server between writes, `wrap` exited, network gone). The
  // last view stays on screen — the header flags that it may be stale.
  const [stale, setStale] = useState<boolean>(false);

  // The 5 s interval closes over the first render — read live state via a ref.
  const uiRef = useRef(ui);
  uiRef.current = ui;

  // Every load (poll, Refresh, task switch) bumps this. Only the newest load
  // may touch shared state, so a slow earlier request finishing last cannot
  // revert a newer result — including the header's updatedAt / stale, which a
  // pre-task-switch or out-of-order response must not update.
  const genRef = useRef(0);
  // The load currently in flight, if any. The auto-poll skips a tick while one
  // is running so a fetch slower than POLL_MS doesn't spawn a pile-up where
  // every response finishes stale-gen and nothing ever updates. Refresh and
  // task switches still fire immediately (they bypass this).
  const inFlightRef = useRef<Promise<void> | null>(null);

  // The single fetch path: refresh the task list and, if a task is selected,
  // its detail — fired concurrently so a selected task's detail is never held
  // up behind the list request. `fetchMetrics` never rejects — a 404 means
  // the task is gone (show it), anything else non-ok is transient (keep the
  // last good view, mark stale). `fetchTasks` still throws; a failure there
  // also marks stale.
  const runLoad = useCallback(async (taskChanged: boolean): Promise<void> => {
    const gen = ++genRef.current;
    const taskAtStart = uiRef.current.task;
    const isLatest = (): boolean => gen === genRef.current;
    let failed = false;

    const tasksDone = fetchTasks().then(
      (next) => {
        if (isLatest()) setTasks(next);
      },
      () => {
        failed = true;
      }
    );

    let detailDone: Promise<void>;
    if (taskAtStart) {
      detailDone = fetchMetrics(taskAtStart).then((r) => {
        const stillSelected = uiRef.current.task === taskAtStart;
        if ((r.ok || r.status === 404) && isLatest() && stillSelected) setDetail(r);
        if (!r.ok && r.status !== 404) failed = true;
      });
    } else {
      if (taskChanged && isLatest()) setDetail(null);
      detailDone = Promise.resolve();
    }

    await Promise.all([tasksDone, detailDone]);

    if (isLatest()) {
      setStale(failed);
      if (!failed) setUpdatedAt(nowClock());
    }
  }, []);

  const load = useCallback(
    (taskChanged = false): Promise<void> => {
      const p = runLoad(taskChanged);
      inFlightRef.current = p;
      void p.finally(() => {
        if (inFlightRef.current === p) inFlightRef.current = null;
      });
      return p;
    },
    [runLoad]
  );

  // Mount: normalise the URL, do the first load, wire popstate + polling.
  useEffect(() => {
    writeUrl(readUrl(), true);
    void load();
    const onPop = (): void => setUi(readUrl());
    window.addEventListener('popstate', onPop);
    const id = window.setInterval(() => {
      if (!document.hidden && !inFlightRef.current) void load();
    }, POLL_MS);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.clearInterval(id);
    };
  }, [load]);

  // Re-fetch immediately when the selected task changes (rather than waiting
  // for the next poll). `load(true)` clears detail when nothing is selected.
  // Skips its very first (mount-time) run — the mount effect above already
  // calls `load()`, which fetches the URL's initial task detail itself; firing
  // both on mount doubled every request when the URL started with `?task=`.
  const skippedMountRun = useRef(false);
  useEffect(() => {
    if (!skippedMountRun.current) {
      skippedMountRun.current = true;
      return;
    }
    setSelectedRequest(null);
    void load(true);
  }, [ui.task, load]);

  const commit = useCallback((next: UiState, replace = false): void => {
    setUi(next);
    writeUrl(next, replace);
  }, []);

  // The detail payload only counts while it is for the current selection —
  // during a task switch (or after a delete) `detail` still holds the previous
  // task until its replacement lands.
  const shownDetail = ui.task && detail?.taskId === ui.task ? detail : null;

  // A hand-edited URL like `?filter=thread` with no `thread=` — fill the
  // default once the payload is in, matching the pre-Preact filter bar.
  useEffect(() => {
    const m = shownDetail?.metrics;
    if (!m) return;
    if (ui.filter === 'thread' && ui.thread == null) {
      const first = m.threadBreakdown.map(threadKeyOfBreakdown)[0];
      if (first != null) commit({ ...ui, thread: first }, true);
    } else if (ui.filter === 'context_class' && ui.cls == null) {
      commit({ ...ui, cls: 'application' }, true);
    }
  }, [shownDetail, ui, commit]);

  const selectTask = useCallback(
    (taskId: string): void => {
      commit({ task: taskId, filter: 'all', thread: null, cls: null });
      setReqSort(DEFAULT_SORT);
      setSelectedRequest(null);
    },
    [commit]
  );

  const setMode = useCallback(
    (mode: FilterMode): void => {
      const next: UiState = { ...uiRef.current, filter: mode };
      if (mode !== 'thread') next.thread = null;
      if (mode !== 'context_class') next.cls = null;
      if (mode === 'thread' && next.thread == null) {
        const keys = (shownDetail?.metrics?.threadBreakdown ?? []).map(threadKeyOfBreakdown);
        next.thread = keys[0] ?? null;
      }
      if (mode === 'context_class' && next.cls == null) next.cls = 'application';
      commit(next);
    },
    [commit, shownDetail]
  );

  const setThread = useCallback(
    (key: string): void => {
      commit({ ...uiRef.current, filter: 'thread', thread: key, cls: null });
    },
    [commit]
  );

  const setContextClass = useCallback(
    (cls: string): void => {
      commit({ ...uiRef.current, filter: 'context_class', cls, thread: null });
    },
    [commit]
  );

  const onSort = useCallback((key: string): void => {
    setReqSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }));
  }, []);

  const onSelectRequest = useCallback((requestIndex: number | null): void => {
    setSelectedRequest(requestIndex);
    setSelectSeq((n) => n + 1);
  }, []);

  const onDeleted = useCallback(
    (taskId: string): void => {
      if (uiRef.current.task === taskId) {
        commit({ task: null, filter: 'all', thread: null, cls: null });
      }
      void load();
    },
    [commit, load]
  );

  return (
    <>
      <Header updatedAt={updatedAt} stale={stale} onRefresh={() => void load()} />
      <div class="layout">
        <aside>
          <h2>Tasks</h2>
          <div id="task-list">
            <TaskList
              tasks={tasks}
              activeTask={ui.task}
              onSelect={selectTask}
              onDeleted={onDeleted}
            />
          </div>
        </aside>
        <main id="detail">
          <Detail
            ui={ui}
            detail={shownDetail}
            loading={ui.task != null && shownDetail == null}
            reqSort={reqSort}
            onSort={onSort}
            onMode={setMode}
            onThread={setThread}
            onContextClass={setContextClass}
            selectedRequest={selectedRequest}
            selectSeq={selectSeq}
            onSelectRequest={onSelectRequest}
          />
        </main>
      </div>
    </>
  );
}
