import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { DataTable, type Column } from './DataTable.tsx';

afterEach(() => cleanup());

interface Row {
  a: string;
  b: string;
}
const cols: Column<Row>[] = [
  { key: 'a', label: 'A', fmt: (r) => r.a },
  { key: 'b', label: 'B', fmt: (r) => r.b },
];

describe('DataTable', () => {
  it('renders a plain table from column defs', () => {
    const { container } = render(<DataTable cols={cols} rows={[{ a: '1', b: '2' }]} />);
    expect([...container.querySelectorAll('th')].map((t) => t.textContent)).toEqual(['A', 'B']);
    expect(container.querySelector('th.sortable')).toBeNull();
    expect([...container.querySelectorAll('tbody td')].map((t) => t.textContent)).toEqual(['1', '2']);
  });

  it('renders sortable headers with a direction arrow and fires onSort', () => {
    const onSort = vi.fn();
    const { container } = render(
      <DataTable
        cols={cols}
        rows={[{ a: '1', b: '2' }]}
        sort={{ key: 'a', dir: 1 }}
        onSort={onSort}
        rowClass={() => 'sel'}
      />
    );
    const th = container.querySelector('th.sortable') as HTMLElement;
    expect(th.dataset.k).toBe('a');
    expect(th.querySelector('.arrow')?.textContent).toContain('▲');
    expect(container.querySelector('tbody tr')?.className).toBe('sel');
    th.click();
    expect(onSort).toHaveBeenCalledWith('a');
  });
});
