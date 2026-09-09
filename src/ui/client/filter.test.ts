import { describe, it, expect } from 'vitest';
import { usageAgg, observedSpanMs, cacheReadShare } from './filter.ts';
import type { RequestRow } from './api.ts';

const row = (over: Partial<RequestRow>): RequestRow => ({
  requestIndex: 0,
  timestamp: '2026-08-29T04:20:00.000Z',
  model: 'm',
  operationType: 'message',
  providerReportedInputTokens: null,
  providerReportedOutputTokens: null,
  cacheCreationInputTokens: null,
  cacheReadInputTokens: null,
  latencyMs: null,
  threadExternalId: '1',
  isSubagent: false,
  applicationBytes: 0,
  protocolBytes: 0,
  unknownBytes: 0,
  exactReuseRatio: null,
  ...over,
});

describe('usageAgg', () => {
  it('counts reported rows so 不明 / partial / complete are distinguishable', () => {
    const none = usageAgg([row({}), row({})], 'providerReportedInputTokens');
    expect(none).toEqual({ sum: 0, have: 0, total: 2 });

    const zero = usageAgg([row({ providerReportedInputTokens: 0 })], 'providerReportedInputTokens');
    expect(zero).toEqual({ sum: 0, have: 1, total: 1 }); // measured zero ≠ not reported

    const partial = usageAgg(
      [row({ providerReportedInputTokens: 100 }), row({})],
      'providerReportedInputTokens'
    );
    expect(partial).toEqual({ sum: 100, have: 1, total: 2 });
  });
});

describe('cacheReadShare', () => {
  const full = (i: number, c: number, rd: number): RequestRow =>
    row({
      providerReportedInputTokens: i,
      cacheCreationInputTokens: c,
      cacheReadInputTokens: rd,
    });

  it('is computed only over rows that reported the whole billing triple', () => {
    const s = cacheReadShare([full(100, 0, 300), full(100, 0, 500)]);
    expect(s).toEqual({ share: 800 / 1000, n: 2, total: 2 });
  });

  it('drops a row missing any of the three and reports partial coverage', () => {
    const s = cacheReadShare([
      full(100, 0, 300),
      row({ providerReportedInputTokens: 100, cacheCreationInputTokens: 0 }), // cache_read null
    ]);
    expect(s).toEqual({ share: 300 / 400, n: 1, total: 2 });
  });

  it('share is null when no row qualified — a missing cache_read is not 0', () => {
    const s = cacheReadShare([
      row({ providerReportedInputTokens: 100, cacheCreationInputTokens: 0 }),
    ]);
    expect(s).toEqual({ share: null, n: 0, total: 1 });
  });
});

describe('observedSpanMs', () => {
  it('is max − min over parseable timestamps, not the array ends', () => {
    // request_index order ≠ time order under parallel requests.
    const rows = [
      row({ requestIndex: 0, timestamp: '2026-08-29T04:20:10.000Z' }),
      row({ requestIndex: 1, timestamp: '2026-08-29T04:20:00.000Z' }),
      row({ requestIndex: 2, timestamp: '2026-08-29T04:20:05.000Z' }),
    ];
    expect(observedSpanMs(rows)).toBe(10_000);
  });

  it('is null when fewer than two timestamps parse', () => {
    expect(observedSpanMs([])).toBeNull();
    expect(observedSpanMs([row({ timestamp: 'nope' }), row({ timestamp: '' })])).toBeNull();
    expect(observedSpanMs([row({ timestamp: '2026-08-29T04:20:00.000Z' })])).toBeNull();
  });
});
