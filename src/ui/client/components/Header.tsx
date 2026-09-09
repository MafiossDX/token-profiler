import type { ComponentChildren } from 'preact';
import { docUrl } from '../docLinks.ts';

// Top bar. Badges state the measurement basis and that all data is local
// (ADR-0014 — `local data`, not `read-only`, since task delete is a write
// path). "updated HH:MM:SS" reflects the last successful poll; when the most
// recent poll threw, `stale` flags that the view below may not be current
// (ADR-0017 §fetch-status). The "ドキュメント" link is always visible here
// (not only inside per-metric ❔ tooltips) for users who never hover a help
// icon — it points at docs/ui-reading-guide.md via the single docUrl() source.
export function Header({
  updatedAt,
  stale = false,
  onRefresh,
}: {
  updatedAt: string;
  stale?: boolean;
  onRefresh: () => void;
}): ComponentChildren {
  return (
    <header>
      <h1>token-profiler</h1>
      <span class="badge">byte basis</span>
      <span class="badge">local data</span>
      <a class="badge" href={docUrl()} target="_blank" rel="noreferrer">
        ドキュメント
      </a>
      <span id="live" class="badge" style="margin-left:auto">
        updated {updatedAt}
      </span>
      {stale ? (
        <span id="stale" class="badge warn-badge" title="直近の取得に失敗しました">
          取得失敗・表示は最新でない可能性
        </span>
      ) : null}
      <button id="refresh" class="copy" style="margin-left:0" onClick={onRefresh}>
        Refresh
      </button>
    </header>
  );
}
