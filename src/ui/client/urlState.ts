// URL <-> view state. The localhost UI keeps its filter selection in the query
// string so a view is linkable and survives reload (docs/ui-information-design
// §3). Param names (`task`, `filter`, `thread`, `class`) are unchanged from the
// pre-Preact client so existing links keep working.

export type FilterMode = 'all' | 'thread' | 'context_class';

export interface UiState {
  task: string | null;
  filter: FilterMode;
  thread: string | null;
  cls: string | null;
}

const FILTERS: FilterMode[] = ['all', 'thread', 'context_class'];

export function readUrl(): UiState {
  const q = new URLSearchParams(location.search);
  const raw = q.get('filter') ?? 'all';
  const filter = (FILTERS as string[]).includes(raw) ? (raw as FilterMode) : 'all';
  return {
    task: q.get('task'),
    filter,
    thread: q.get('thread'),
    cls: q.get('class'),
  };
}

export function toQuery(s: UiState): string {
  const q = new URLSearchParams();
  if (s.task) q.set('task', s.task);
  if (s.filter !== 'all') q.set('filter', s.filter);
  if (s.filter === 'thread' && s.thread != null) q.set('thread', s.thread);
  if (s.filter === 'context_class' && s.cls != null) q.set('class', s.cls);
  return q.toString();
}

export function writeUrl(s: UiState, replace: boolean): void {
  const q = toQuery(s);
  const url = location.pathname + (q ? '?' + q : '');
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
}
