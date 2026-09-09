// Centralized GitHub doc-link constants (single source — no component should
// build a github.com URL by hand). Points at docs/ui-reading-guide.md, the
// user-facing reading guide; anchors match the explicit <a id="..."> tags in
// that file rather than GitHub's auto-generated (Japanese/English-mixed,
// fragile) heading slugs.
export const DOC_REPO = 'MafiossDX/token-profiler';
export const DOC_BRANCH = 'main';
export const DOC_PATH = 'docs/ui-reading-guide.md';

export const DOC_BASE_URL = `https://github.com/${DOC_REPO}/blob/${DOC_BRANCH}/${DOC_PATH}`;

export const DOC_ANCHOR = {
  sec1: 'sec-1-current-amplification',
  sec2: 'sec-2-next-focus',
  sec3: 'sec-3-request-explorer',
  sec4: 'sec-4-amp-chart',
  sec5: 'sec-5-reuse-breakdown',
  metricSlope: 'metric-slope',
  metricFirst5: 'metric-first5',
  metricDupBytes: 'metric-dup-bytes',
  metricTopReq: 'metric-top-req',
  metricAmp: 'metric-current-amplification',
  metricCacheReadShare: 'metric-cache-read-share',
  metricUcvCtv: 'metric-ucv-ctv',
  metricClassCoverage: 'metric-classification-coverage',
  metricConcentration: 'metric-concentration',
  reqDetail: 'sec-reqdetail',
  reqDetailDupBytes: 'reqdetail-dup-bytes',
  reqDetailGapShare: 'reqdetail-gap-share',
  reqDetailRank: 'reqdetail-rank',
  reqDetailReuseRatio: 'reqdetail-reuse-ratio',
  reqDetailRunningAmp: 'reqdetail-running-amp',
} as const;

export type DocAnchor = (typeof DOC_ANCHOR)[keyof typeof DOC_ANCHOR];

export function docUrl(anchor?: DocAnchor): string {
  return anchor ? `${DOC_BASE_URL}#${anchor}` : DOC_BASE_URL;
}
