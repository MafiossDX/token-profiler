import { describe, it, expect, beforeEach } from 'vitest';
import { readUrl, toQuery, writeUrl, type UiState } from './urlState.ts';

function setSearch(search: string): void {
  history.replaceState(null, '', '/' + (search ? '?' + search : ''));
}

describe('urlState', () => {
  beforeEach(() => setSearch(''));

  it('reads task / filter / thread / class and validates the filter mode', () => {
    setSearch('task=t1&filter=thread&thread=2a8');
    expect(readUrl()).toEqual({ task: 't1', filter: 'thread', thread: '2a8', cls: null });

    setSearch('task=t1&filter=bogus');
    expect(readUrl().filter).toBe('all');
  });

  it('toQuery drops thread/class unless the matching filter is active', () => {
    const base: UiState = { task: 't1', filter: 'all', thread: '2a8', cls: 'application' };
    expect(toQuery(base)).toBe('task=t1');
    expect(toQuery({ ...base, filter: 'thread' })).toBe('task=t1&filter=thread&thread=2a8');
    expect(toQuery({ ...base, filter: 'context_class' })).toBe(
      'task=t1&filter=context_class&class=application'
    );
  });

  it('writeUrl round-trips through readUrl', () => {
    const s: UiState = { task: 'abc', filter: 'context_class', thread: null, cls: 'protocol' };
    writeUrl(s, true);
    expect(readUrl()).toEqual(s);
  });
});
