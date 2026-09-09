import { describe, it, expect } from 'vitest';
import { grp, bytes, pct, ratio, dur, durMs, clock } from './format.ts';

describe('format helpers', () => {
  it('groups, suffixes and ratios numbers; n/a on null', () => {
    expect(grp(1234567)).toBe('1,234,567');
    expect(grp(null)).toBe('n/a');
    expect(bytes(2048)).toBe('2,048 B');
    expect(pct(0.156)).toBe('15.6%');
    expect(pct(null)).toBe('n/a');
    expect(ratio(3.14159)).toBe('3.14x');
  });

  it('dur() renders h/m/s and blanks on bad input', () => {
    expect(dur('2026-08-29T04:20:00.000Z', '2026-08-29T04:36:48.000Z')).toBe('16m48s');
    expect(dur('2026-08-29T05:00:00.000Z', '2026-08-29T04:00:00.000Z')).toBe('');
    expect(dur(null, '2026-08-29T04:00:00.000Z')).toBe('');
  });

  it('durMs() formats a span and blanks a negative / non-finite one', () => {
    expect(durMs(0)).toBe('0s');
    expect(durMs(125_000)).toBe('2m5s');
    expect(durMs(3_661_000)).toBe('1h1m1s');
    expect(durMs(-1)).toBe('');
    expect(durMs(NaN)).toBe('');
  });

  it('clock() is wall-clock in the viewer local zone, not UTC (ui-review §4)', () => {
    const iso = '2026-08-29T04:20:00.000Z';
    expect(clock(iso)).toBe(new Date(iso).toTimeString().slice(0, 8));
    expect(clock('')).toBe('—');
    // Runner TZ is pinned to America/New_York in vitest.config.ts.
    expect(new Date(iso).getTimezoneOffset()).not.toBe(0);
    expect(clock(iso)).not.toBe(new Date(iso).toISOString().slice(11, 19));
  });
});
