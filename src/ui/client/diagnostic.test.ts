import { describe, it, expect } from 'vitest';
import { derive, zone, zoneLabel } from './diagnostic.ts';
import { fixture } from './test/fixture.ts';
import type { TaskMetrics } from './api.ts';

describe('zone', () => {
  it('maps amplification to the reference band', () => {
    expect(zone(1)).toBe('ok');
    expect(zone(1.99)).toBe('ok');
    expect(zone(2)).toBe('watch');
    expect(zone(4.99)).toBe('watch');
    expect(zone(5)).toBe('warn');
    expect(zone(9.99)).toBe('warn');
    expect(zone(10)).toBe('crit');
    expect(zone(null)).toBe('ok');
  });

  it('labels the band as a plain ratio range (ADR-0017 — no verdict words)', () => {
    expect(zoneLabel(1.5)).toBe('1–2x');
    expect(zoneLabel(2)).toBe('2–5x');
    expect(zoneLabel(6)).toBe('5–10x');
    expect(zoneLabel(12)).toBe('10x 以上');
    expect(zoneLabel(null)).toBe('1–2x');
  });
});

describe('derive', () => {
  const { metrics } = fixture();

  it('sums duplicate context bytes to CTV − UCV and gap shares to 1', () => {
    const d = derive(metrics);
    const sumDup = d.rows.reduce((a, r) => a + r.dupBytes, 0);
    expect(sumDup).toBe(d.gap);
    expect(Math.abs(d.gap - (d.ctv - d.ucv))).toBeLessThanOrEqual(1);
    const shareSum = d.rows.reduce((a, r) => a + r.gapShare, 0);
    expect(shareSum).toBeCloseTo(1, 6);
  });

  it('ranks requests by duplicate context bytes, descending', () => {
    const d = derive(metrics);
    expect(d.ranked.map((r) => r.requestIndex)).toEqual([2, 1, 0]);
    expect(d.topReq?.requestIndex).toBe(2);
    for (let i = 1; i < d.ranked.length; i++) {
      expect(d.ranked[i - 1].dupBytes).toBeGreaterThanOrEqual(d.ranked[i].dupBytes);
    }
  });

  it('picks the thread carrying the most duplicate context bytes', () => {
    const d = derive(metrics);
    expect(d.topThread?.thread).toBe('2a8');
    expect(d.threads[0].dupBytes).toBeGreaterThanOrEqual(d.threads[1].dupBytes);
    expect(d.threads.reduce((a, t) => a + t.dupBytes, 0)).toBe(d.gap);
  });

  it('builds a non-decreasing Pareto with k50 / k80 as reach counts', () => {
    const d = derive(metrics);
    for (let i = 1; i < d.pareto.length; i++) {
      expect(d.pareto[i].cumShare).toBeGreaterThanOrEqual(d.pareto[i - 1].cumShare);
    }
    expect(d.pareto[d.pareto.length - 1].cumShare).toBeCloseTo(1, 6);
    expect(d.k50).toBe(1);
    expect(d.k80).toBe(2);
  });

  it('reconstructs running amplification in request order without rescaling', () => {
    const d = derive(metrics);
    expect(d.rows.map((r) => r.requestIndex)).toEqual([0, 1, 2]);
    expect(d.rows[0].runningAmp).toBeCloseTo(1, 6);
    for (let i = 1; i < d.rows.length; i++) {
      expect(d.rows[i].runningAmp).toBeGreaterThanOrEqual(d.rows[i - 1].runningAmp - 1e-9);
    }
    expect(d.first5).toBeNull();
    expect(d.slope).toBeCloseTo((d.rows[2].runningAmp - d.rows[0].runningAmp) / 2, 6);
  });

  it('reports first5 when running amplification crosses 5x', () => {
    const m: TaskMetrics = {
      ...metrics,
      requestRows: [
        { ...metrics.requestRows[0], requestIndex: 0, applicationBytes: 1000, exactReuseRatio: 0 },
        { ...metrics.requestRows[0], requestIndex: 1, applicationBytes: 100000, exactReuseRatio: 0.99 },
      ],
      exactReuseByRequest: [
        { requestId: 'r0', requestIndex: 0, exactReuseRatio: 0, reusedBytes: 0, totalBytes: 1000 },
        { requestId: 'r1', requestIndex: 1, exactReuseRatio: 0.99, reusedBytes: 99000, totalBytes: 100000 },
      ],
    };
    const d = derive(m);
    expect(d.first5).toBe(1);
  });

  it('handles an empty task without throwing', () => {
    const m: TaskMetrics = { ...metrics, requestRows: [], exactReuseByRequest: [] };
    const d = derive(m);
    expect(d.gap).toBe(0);
    expect(d.rows).toEqual([]);
    expect(d.topReq).toBeNull();
    expect(d.k80).toBe(0);
  });
});
