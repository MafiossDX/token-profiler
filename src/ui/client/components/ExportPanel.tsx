import type { ComponentChildren } from 'preact';
import type { TaskMetrics } from '../api.ts';
import type { UiState } from '../urlState.ts';
import { Note } from './primitives.tsx';
import { DownloadLink } from './DownloadLink.tsx';

// Export — carry the raw rows out to another tool. Embedded in `Detail.tsx`'s
// `task-head` inside a `<details class="export">` (ADR-0018; moved out of a
// numbered bottom panel, ADR-0016 §3.6/ADR-0017). This is the full export
// surface; the per-view <ViewExport> links (e.g. inside 「3 · request 調査」)
// are the filtered shortcuts.
export function ExportPanel({
  metrics,
  state,
}: {
  metrics: TaskMetrics;
  state: UiState;
}): ComponentChildren {
  const base = '/api/tasks/' + encodeURIComponent(metrics.taskId);

  return (
    <>
      <p class="sub" style="margin:10px 0 2px">
        <strong>この Task 全体</strong>
      </p>
      <DownloadLink href={base + '/export.json'} label="metrics.json" note="computeTaskMetrics の全出力" />
      <DownloadLink href={base + '/requests.csv'} label="requests.csv" note="request 単位の生行" />
      <DownloadLink
        href={base + '/requests.jsonl'}
        label="requests.jsonl"
        note="request 単位の生行 (JSON Lines)"
      />
      <DownloadLink
        href={base + '/threads.csv'}
        label="threads.csv"
        note="Conversation Thread 集計 (adapter 由来 · not Core)"
      />
      <DownloadLink
        href={base + '/blocks.csv'}
        label="blocks.csv"
        note="StructuralBlock 単位 (type / context_class / byte_length)"
      />

      {state.filter === 'thread' && state.thread != null ? (
        <ThreadScoped base={base} thread={state.thread} />
      ) : null}
      {state.filter === 'context_class' && state.cls != null ? (
        <ContextClassScoped base={base} cls={state.cls} />
      ) : null}
    </>
  );
}

function ThreadScoped({ base, thread }: { base: string; thread: string }): ComponentChildren {
  const q = '?thread=' + encodeURIComponent(thread);
  return (
    <>
      <p class="sub" style="margin:14px 0 2px">
        <strong>現在のフィルタ</strong> — thread={thread}
      </p>
      <DownloadLink
        href={base + '/export.json' + q}
        label="metrics.json"
        note="requestRows / threadBreakdown をこの thread に限定 (scalar は task 全体)"
      />
      <DownloadLink href={base + '/requests.csv' + q} label="requests.csv" note="この thread の request のみ" />
      <DownloadLink
        href={base + '/requests.jsonl' + q}
        label="requests.jsonl"
        note="この thread の request のみ"
      />
      <DownloadLink href={base + '/threads.csv' + q} label="threads.csv" note="この thread の行のみ" />
      <DownloadLink href={base + '/blocks.csv' + q} label="blocks.csv" note="この thread の block のみ" />
    </>
  );
}

function ContextClassScoped({ base, cls }: { base: string; cls: string }): ComponentChildren {
  const q = '?context_class=' + encodeURIComponent(cls);
  return (
    <>
      <p class="sub" style="margin:14px 0 2px">
        <strong>現在のフィルタ</strong> — context_class={cls}
      </p>
      <DownloadLink href={base + '/blocks.csv' + q} label="blocks.csv" note={'context_class=' + cls + ' の block のみ'} />
      <Note>
        context_class は StructuralBlock 単位の属性のため、request / thread 単位のエクスポートはこの軸では絞り込めない。
      </Note>
    </>
  );
}
