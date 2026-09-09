import { describe, it, expect } from 'vitest';
import { pageCount, clampPage, pageSlice } from './pagination.ts';

function rows(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

describe('pageCount', () => {
  it('is 1 for zero rows (a single, empty page)', () => {
    expect(pageCount(0, 20)).toBe(1);
  });

  it('is 1 when rows fit in one page, including exactly pageSize rows', () => {
    expect(pageCount(1, 20)).toBe(1);
    expect(pageCount(20, 20)).toBe(1);
  });

  it('rounds up for a partial last page', () => {
    expect(pageCount(21, 20)).toBe(2);
    expect(pageCount(1000, 20)).toBe(50);
  });
});

describe('clampPage', () => {
  it('clamps negative and NaN pages to 0', () => {
    expect(clampPage(-1, 1000, 20)).toBe(0);
    expect(clampPage(Number.NaN, 1000, 20)).toBe(0);
  });

  it('clamps a page past the end to the last valid page', () => {
    expect(clampPage(999, 21, 20)).toBe(1); // pages 0..1
    expect(clampPage(5, 0, 20)).toBe(0); // 0 rows → single empty page
  });

  it('leaves an in-range page untouched', () => {
    expect(clampPage(1, 21, 20)).toBe(1);
    expect(clampPage(49, 1000, 20)).toBe(49);
  });
});

describe('pageSlice', () => {
  it('returns an empty slice for 0 rows', () => {
    expect(pageSlice(rows(0), 0, 20)).toEqual([]);
  });

  it('returns all rows on the only page when total === pageSize', () => {
    expect(pageSlice(rows(1), 0, 20)).toEqual([0]);
    expect(pageSlice(rows(20), 0, 20)).toEqual(rows(20));
  });

  it('splits pageSize+1 rows into a full page and a one-row remainder, no overlap or gap', () => {
    const all = rows(21);
    const p0 = pageSlice(all, 0, 20);
    const p1 = pageSlice(all, 1, 20);
    expect(p0).toEqual(rows(20));
    expect(p1).toEqual([20]);
    expect(p0.concat(p1)).toEqual(all);
  });

  it('covers every row of a large set with no duplicate or missing index', () => {
    const all = rows(1000);
    const pages = pageCount(all.length, 20);
    const seen: number[] = [];
    for (let p = 0; p < pages; p++) seen.push(...pageSlice(all, p, 20));
    expect(seen).toEqual(all);
  });

  it('clamps an out-of-range page instead of returning an empty slice', () => {
    // e.g. the row count shrank (filter/poll) after `page` was set higher.
    expect(pageSlice(rows(21), 5, 20)).toEqual([20]); // clamps to last page (1)
  });
});
