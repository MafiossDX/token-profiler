// Pure client-side pagination helpers (ui-review §1: "フィルタ → 全対象の
// ソート → ページ分割"). These never see the unsorted/unfiltered rows — a
// caller filters and sorts first, then slices. No component state here; page
// index correction (when a filter/poll shrinks the row count) is exposed as
// `clampPage` so a caller can re-derive a safe page every render instead of
// storing a possibly-stale one.

export function pageCount(total: number, pageSize: number): number {
  if (total <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

// Clamp a page index into [0, pageCount-1]. `total === 0` clamps to 0 (the
// single, empty page) — callers distinguish "no data" from "0 of N" by
// checking `total` themselves, not by inspecting the page.
export function clampPage(page: number, total: number, pageSize: number): number {
  const last = pageCount(total, pageSize) - 1;
  if (!Number.isFinite(page) || page < 0) return 0;
  if (page > last) return last;
  return page;
}

export function pageSlice<T>(rows: T[], page: number, pageSize: number): T[] {
  const p = clampPage(page, rows.length, pageSize);
  const start = p * pageSize;
  return rows.slice(start, start + pageSize);
}
