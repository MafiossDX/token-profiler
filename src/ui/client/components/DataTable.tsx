import type { ComponentChildren } from 'preact';

// The single place the Threads / Requests tables build their thead/tbody
// (ui-review §3). Replaces the pre-Preact `renderTable(cols, rows, opts)`
// string builder with a component — same column-def contract, Preact escapes
// cell content for us so `fmt` may return a string or a VNode.

export interface Column<T> {
  key: string;
  label: string;
  fmt: (row: T) => ComponentChildren;
}

interface Props<T> {
  cols: Column<T>[];
  rows: T[];
  // Present → header cells are sortable; the active one shows a direction arrow.
  sort?: { key: string; dir: number };
  onSort?: (key: string) => void;
  rowClass?: (row: T) => string;
  rowAttrs?: (row: T) => Record<string, string>;
  rowKey?: (row: T, i: number) => string | number;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({
  cols,
  rows,
  sort,
  onSort,
  rowClass,
  rowAttrs,
  rowKey,
  onRowClick,
}: Props<T>): ComponentChildren {
  const sortable = sort != null && onSort != null;
  return (
    <table>
      <thead>
        <tr>
          {cols.map((c) =>
            sortable ? (
              <th
                key={c.key}
                class="sortable"
                data-k={c.key}
                onClick={() => onSort!(c.key)}
              >
                {c.label}
                {sort!.key === c.key ? (
                  <span class="arrow"> {sort!.dir > 0 ? '▲' : '▼'}</span>
                ) : null}
              </th>
            ) : (
              <th key={c.key}>{c.label}</th>
            )
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const cls = rowClass ? rowClass(r) : '';
          return (
            <tr
              key={rowKey ? rowKey(r, i) : i}
              class={cls || undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              {...(rowAttrs ? rowAttrs(r) : {})}
            >
              {cols.map((c) => (
                <td key={c.key}>{c.fmt(r)}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
