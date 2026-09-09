import type { ComponentChildren } from 'preact';
import { exportQuery, EXPORT_LABEL } from '../filter.ts';
import type { UiState } from '../urlState.ts';

// One "<a download>" row. Reused by view 6 (the full Export surface) and the
// per-view export links (ui-review §2).
export function DownloadLink({
  href,
  label,
  note,
  extraClass,
}: {
  href: string;
  label: string;
  note?: string;
  extraClass?: string;
}): ComponentChildren {
  return (
    <div class={'dl' + (extraClass ? ' ' + extraClass : '')}>
      <a href={href} download>
        {label}
      </a>
      {note ? <span class="sub"> — {note}</span> : null}
    </div>
  );
}

// "Download this view's data" link(s) for a section, honouring the current
// filter (ui-review §2). View 6 stays the full export surface.
export function ViewExport({
  taskId,
  kinds,
  state,
}: {
  taskId: string;
  kinds: string[];
  state: UiState;
}): ComponentChildren {
  const base = '/api/tasks/' + encodeURIComponent(taskId);
  return (
    <>
      {kinds.map((kind, i) => {
        const q = exportQuery(state, kind);
        return (
          <DownloadLink
            key={kind}
            href={base + '/' + kind + q}
            label={EXPORT_LABEL[kind] ?? kind}
            extraClass={i === 0 ? 'viewdl' : undefined}
          />
        );
      })}
    </>
  );
}
