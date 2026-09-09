import type { ComponentChildren } from 'preact';
import type { TaskListItem } from '../api.ts';
import { deleteTask as apiDeleteTask } from '../api.ts';
import { clock, ratio } from '../format.ts';

// Sidebar task list. Each row selects a task; the `×` is the confirmation-gated
// delete (ADR-0014). A task still marked running (`endedAt` null, i.e. `wrap`
// may still be writing) gets a stronger, more explicit confirmation instead of
// being permanently undeletable — `endedAt` is only ever set on a clean `wrap`
// exit, so a killed/crashed session leaves a task "running" forever with no
// other way to ever remove it (force-delete rescue path).
export function TaskList({
  tasks,
  activeTask,
  onSelect,
  onDeleted,
}: {
  tasks: TaskListItem[];
  activeTask: string | null;
  onSelect: (taskId: string) => void;
  onDeleted: (taskId: string) => void;
}): ComponentChildren {
  if (!tasks.length) {
    return (
      <p class="sub" style="padding:0 12px">
        No tasks recorded yet.
      </p>
    );
  }

  async function onDelete(t: TaskListItem, running: boolean): Promise<void> {
    const ok = running
      ? window.confirm(
          'Task still marked as running\n\n' +
            t.taskId +
            '\n\n' +
            'This task has no end time recorded. That usually means the wrapped ' +
            'process was killed or crashed rather than exiting normally — if a ' +
            'session is genuinely still active, deleting it now could remove rows ' +
            'a live process is writing to.\n\n' +
            'Force-delete this task and all ' +
            t.requestCount +
            ' request(s) anyway? This cannot be undone.'
        )
      : window.confirm(
          'Delete task\n\n' +
            t.taskId +
            '\n\n' +
            t.requestCount +
            ' request(s) and all derived rows will be removed. This cannot be undone.'
        );
    if (!ok) return;
    const res = await apiDeleteTask(t.taskId, { force: running });
    if (!res.ok) {
      window.alert('Delete failed: ' + res.error);
      return;
    }
    onDeleted(t.taskId);
  }

  return (
    <>
      {tasks.map((t) => {
        const running = t.endedAt == null;
        return (
          <div class="task-row" key={t.taskId}>
            <button
              class={'task-item' + (t.taskId === activeTask ? ' active' : '')}
              onClick={() => onSelect(t.taskId)}
            >
              <div class="tid">{t.taskId.slice(0, 8)}</div>
              <div class="meta">
                {clock(t.createdAt)} · {t.requestCount} req
                {t.contextAmplification != null ? ' · ' + ratio(t.contextAmplification) : ''}
              </div>
            </button>
            <button
              class={'task-del' + (running ? ' running' : '')}
              title={running ? 'still marked running — force delete' : 'Delete task'}
              onClick={(e) => {
                e.stopPropagation();
                void onDelete(t, running);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </>
  );
}
