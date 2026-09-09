import type { ComponentChildren } from 'preact';
import type { TaskMetrics } from '../api.ts';
import type { UiState, FilterMode } from '../urlState.ts';
import { threadKeyOfBreakdown } from '../filter.ts';

const MODES: { value: FilterMode; text: string }[] = [
  { value: 'all', text: 'All traffic' },
  { value: 'thread', text: 'thread' },
  { value: 'context_class', text: 'context_class' },
];

const CONTEXT_CLASSES = ['application', 'protocol', 'unknown'];

// Filter bar (docs/ui-information-design §3). The selection is also the scope
// for the Requests table and every Export link.
export function Filters({
  metrics,
  state,
  onMode,
  onThread,
  onContextClass,
}: {
  metrics: TaskMetrics;
  state: UiState;
  onMode: (mode: FilterMode) => void;
  onThread: (key: string) => void;
  onContextClass: (cls: string) => void;
}): ComponentChildren {
  const threadKeys = (metrics.threadBreakdown ?? []).map(threadKeyOfBreakdown);

  return (
    <div class="filters">
      <strong>Filter</strong>
      {MODES.map((m) => (
        <label key={m.value}>
          <input
            type="radio"
            name="flt"
            value={m.value}
            checked={state.filter === m.value}
            onChange={() => onMode(m.value)}
          />{' '}
          {m.text}
        </label>
      ))}

      {state.filter === 'thread' ? (
        <select
          value={state.thread ?? undefined}
          onChange={(e) => onThread((e.target as HTMLSelectElement).value)}
        >
          {threadKeys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      ) : null}

      {state.filter === 'context_class' ? (
        <select
          value={state.cls ?? undefined}
          onChange={(e) => onContextClass((e.target as HTMLSelectElement).value)}
        >
          {CONTEXT_CLASSES.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
