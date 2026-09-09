import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/preact';
import { App } from './app.tsx';
import { fixture, fixtureFor, manyRowsFixture, makeFetch, deferred } from './test/fixture.ts';

// ADR-0018: panels 5(重複の多い request)+6(タイムライン)+7(request 表) merged
// into 3「request 調査」(list⇄timeline toggle); Export is no longer a numbered
// panel (see the `.task-head details.export` assertion below).
const PANELS = [
  '1 · Current amplification',
  '2 · Next focus',
  '3 · request 調査',
  '4 · 推移・閾値プロット',
  '5 · 重複文脈バイトの内訳',
];

function go(search: string): void {
  history.replaceState(null, '', '/' + (search ? '?' + search : ''));
}

function stubFetch(over: Parameters<typeof makeFetch>[0] = {}): void {
  vi.stubGlobal('fetch', makeFetch(over));
}

function mountSelected() {
  const fx = fixture();
  go(`task=${fx.taskId}`);
  stubFetch({ tasks: [fx.listItem], metrics: { [fx.taskId]: fx.metrics } });
  return { fx, ...render(<App />) };
}

const reqRows = (c: Element): HTMLTableRowElement[] =>
  [...c.querySelectorAll('#view-requests tbody tr')] as HTMLTableRowElement[];

// 「3 · request 調査」defaults to the list view; the (outer) list⇄timeline
// toggle lives in its own `.toolbar .tl-seg` — distinct from Timeline's own
// (inner, only rendered once switched) minimap/lanes `.tl-seg`.
function switchToTimelineView(c: Element): void {
  const btn = [...c.querySelectorAll('#view-requests .toolbar .tl-seg button')].find(
    (b) => b.textContent === 'タイムライン'
  ) as HTMLElement;
  btn.click();
}

describe('<App>', () => {
  beforeEach(() => go(''));
  afterEach(() => cleanup());

  it('renders the diagnostic panels and the selected task in the sidebar', async () => {
    const { container, findByText } = mountSelected();
    await findByText('1 · Current amplification');

    for (const label of PANELS) {
      expect([...container.querySelectorAll('h3')].some((h) => h.textContent === label)).toBe(true);
    }
    expect(container.querySelectorAll('#task-list .task-item').length).toBe(1);
    expect(reqRows(container).length).toBe(3);
    expect(container.querySelector('#view-amp')?.textContent).toContain('3.14x');
    // reference zone class on the score block
    expect(container.querySelector('#view-amp .score')?.className).toContain('zone-watch');

    // ADR-0018: panels stay in the new 1→2→3→4→5 order, and Export is not
    // among them — it sits beside the Task heading instead. Filter out the
    // unnumbered "Request detail" heading nested inside 3 · request 調査.
    const order = [...container.querySelectorAll('main h3')]
      .map((h) => h.textContent)
      .filter((t) => PANELS.includes(t as string));
    expect(order).toEqual(PANELS);
    expect(container.querySelector('.task-head details.export summary')?.textContent).toBe('Export');

    // ADR-0018: 「3 · request 調査」pairs its current view (list by default)
    // with Request detail in `.two-col`; switching to the timeline view keeps
    // that pairing without a page-length sticky sidebar.
    const pairList = container.querySelector('#view-requests .two-col');
    expect(pairList?.querySelector('.scrollx table')).toBeTruthy();
    expect(pairList?.querySelector('#view-reqdetail')).toBeTruthy();

    switchToTimelineView(container);
    await waitFor(() => {
      const pairTimeline = container.querySelector('#view-requests .two-col');
      expect(pairTimeline?.querySelector('#view-timeline')).toBeTruthy();
      expect(pairTimeline?.querySelector('#view-reqdetail')).toBeTruthy();
    });
  });

  it('Next focus points at the largest thread / request and the Pareto is stated', async () => {
    const { container, findByText } = mountSelected();
    await findByText('2 · Next focus');

    const nf = container.querySelector('#view-nextfocus')!.textContent!;
    expect(nf).toContain('2a8'); // thread with the most duplicate context bytes
    expect(nf).toContain('#2'); // request with the most duplicate context bytes

    expect(container.querySelector('#view-requests')?.textContent).toContain(
      '上位 2 req で重複文脈ボリューム全体の 80%'
    );
  });

  it('the request table defaults to duplicate-context-bytes descending', async () => {
    const { container, findByText } = mountSelected();
    await findByText('3 · request 調査');
    expect(reqRows(container).map((r) => r.children[0].textContent)).toEqual(['#2', '#1', '#0']);

    // provider input tokens only appear once 詳細列 is toggled on.
    const detailToggle = [...container.querySelectorAll('#view-requests label input[type="checkbox"]')][0] as HTMLElement;
    detailToggle.click();

    const th = await waitFor(() => {
      const found = [...container.querySelectorAll('#view-requests th.sortable')].find(
        (e) => (e as HTMLElement).dataset.k === 'providerReportedInputTokens'
      ) as HTMLElement;
      expect(found).toBeTruthy();
      return found;
    });
    // compact cols: #, thread, 重複文脈B, reuse, gap% (0-4); detail cols start
    // at 5: time, m/s, model, op, in(9).
    const inCol = (): number[] =>
      reqRows(container).map((r) => Number(r.children[9].textContent!.replace(/,/g, '')));

    th.click();
    await waitFor(() => expect(inCol()).toEqual([...inCol()].sort((a, b) => a - b)));
    const asc = inCol();
    th.click();
    await waitFor(() => expect(inCol()).toEqual([...asc].reverse()));
  });

  it('opens with the top reduction candidate already selected, like abtest-c5.html', async () => {
    const { container, findByText } = mountSelected();
    await findByText('3 · request 調査');

    // #2 carries the most duplicate context bytes in the fixture — Next focus,
    // the list, and the Request detail pane must agree from first paint.
    await waitFor(() => {
      expect(container.querySelector('#view-reqdetail h3')?.textContent).toBe('Request #2');
      expect(
        container.querySelector('#view-requests tr[data-req="2"]')?.className
      ).toContain('sel');
    });

    // ADR-0017: the note states the observed duplicate volume, not a
    // counterfactual "除くと … 減る".
    expect(container.querySelector('#view-reqdetail')?.textContent).not.toContain('除くと');

    const row = container.querySelector('#view-requests tr[data-req="1"]') as HTMLElement;
    row.click();
    await waitFor(() => {
      expect(container.querySelector('#view-reqdetail h3')?.textContent).toBe('Request #1');
      expect(container.querySelector('#view-reqdetail .split')?.textContent).toContain('重複');
    });
  });

  it('Next focus cards jump to that thread / request (ADR-0017)', async () => {
    const { container, findByText } = mountSelected();
    await findByText('2 · Next focus');

    const cards = [...container.querySelectorAll('#view-nextfocus button.focus-card')];
    expect(cards.length).toBe(3);

    // Wait for the auto-selected top request, then move the selection off it.
    await waitFor(() =>
      expect(container.querySelector('#view-reqdetail h3')?.textContent).toBe('Request #2')
    );
    (container.querySelector('#view-requests tr[data-req="1"]') as HTMLElement).click();
    await waitFor(() =>
      expect(container.querySelector('#view-reqdetail h3')?.textContent).toBe('Request #1')
    );

    // Request card → re-selects the top duplicate-context request (#2).
    (cards[1] as HTMLElement).click();
    await waitFor(() =>
      expect(container.querySelector('#view-reqdetail h3')?.textContent).toBe('Request #2')
    );

    // Thread card → applies the thread filter for the top thread (2a8).
    (cards[0] as HTMLElement).click();
    await waitFor(() => {
      expect(location.search).toMatch(/filter=thread/);
      expect(location.search).toContain('thread=2a8');
    });
  });

  it('Next focus from a filtered-out thread widens the filter so the row stays visible', async () => {
    const fx = fixture();
    // Start filtered to thread 915 (holds only #1). Next focus points at #2 in
    // thread 2a8 — clicking it must switch the filter, not just the detail.
    go(`task=${fx.taskId}&filter=thread&thread=915`);
    stubFetch({ tasks: [fx.listItem], metrics: { [fx.taskId]: fx.metrics } });
    const { container, findByText } = render(<App />);
    await findByText('2 · Next focus');

    const cards = [...container.querySelectorAll('#view-nextfocus button.focus-card')];
    (cards[1] as HTMLElement).click(); // Request card → #2 (thread 2a8)

    await waitFor(() => {
      expect(location.search).toContain('thread=2a8');
      expect(container.querySelector('#view-reqdetail h3')?.textContent).toBe('Request #2');
      // #2 is now inside the list's scope and marked selected.
      expect(
        container.querySelector('#view-requests tr[data-req="2"]')?.className
      ).toContain('sel');
    });
  });

  it('reselecting the already-selected request still jumps back to its page (code review P2 #1)', async () => {
    const taskId = 'task-many-1';
    const fx = manyRowsFixture(taskId, 45);
    go(`task=${taskId}`);
    stubFetch({ tasks: [fx.listItem], metrics: { [taskId]: fx.metrics } });
    const { container, findByText } = render(<App />);
    await findByText('3 · request 調査');

    // Auto-selected on load: #0 carries the most duplicate context bytes, and
    // starts out on page 1 of 3 (pageSize 20).
    await waitFor(() =>
      expect(container.querySelector('#view-reqdetail h3')?.textContent).toBe('Request #0')
    );
    const pagerText = () => container.querySelector('#view-requests .pager .sub')?.textContent ?? '';
    expect(pagerText()).toContain('ページ 1 / 3');

    // Move to page 2 manually — the selection itself doesn't change.
    const nextBtn = [...container.querySelectorAll('#view-requests .pager button')].find(
      (b) => b.textContent === '次へ →'
    ) as HTMLElement;
    nextBtn.click();
    await waitFor(() => expect(pagerText()).toContain('ページ 2 / 3'));

    // Re-click the Next focus "Request" card — same requestIndex (#0) as
    // already selected. Must still navigate back to its page (page 1), not
    // leave the view on page 2 (repro: 45 rows, select max, move to page 2,
    // click Next focus's Request card again).
    const cards = [...container.querySelectorAll('#view-nextfocus button.focus-card')];
    (cards[1] as HTMLElement).click();
    await waitFor(() => expect(pagerText()).toContain('ページ 1 / 3'));
  });

  it('the # cell is a keyboard-operable button, not only a row click (code review P2 #2)', async () => {
    const { container, findByText } = mountSelected();
    await findByText('3 · request 調査');

    const btn = container.querySelector(
      '#view-requests tr[data-req="1"] button[data-req-select]'
    ) as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    expect(btn!.tagName).toBe('BUTTON');
    btn!.click();
    await waitFor(() =>
      expect(container.querySelector('#view-reqdetail h3')?.textContent).toBe('Request #1')
    );
  });

  it('a transient fetch failure keeps the last view and freezes updatedAt', async () => {
    const { container, findByText } = mountSelected();
    await findByText('1 · Current amplification');
    expect(container.querySelector('#stale')).toBeNull();
    const wasUpdated = container.querySelector('#live')?.textContent;

    // 500 on the task list + detail: keep the amplification number on screen,
    // flag stale, and do NOT advance the last-success time.
    vi.stubGlobal('fetch', () => Promise.reject(new Error('server down')));
    (container.querySelector('#refresh') as HTMLElement).click();
    await waitFor(() => expect(container.querySelector('#stale')).toBeTruthy());
    expect(container.querySelector('#stale')?.textContent).toContain('最新でない可能性');
    expect(container.querySelector('#detail')?.textContent).toContain('3.14x');
    expect(container.querySelector('#live')?.textContent).toBe(wasUpdated);
  });

  it('shows 不明 for provider usage a thread never reported (plan §3)', async () => {
    const fx = fixture();
    // thread 915 = request #1 only; blank its provider usage.
    for (const r of fx.metrics.requestRows) {
      if (r.threadExternalId === '915') {
        r.providerReportedInputTokens = null;
        r.providerReportedOutputTokens = null;
        r.cacheCreationInputTokens = null;
        r.cacheReadInputTokens = null;
      }
    }
    go(`task=${fx.taskId}&filter=thread&thread=915`);
    stubFetch({ tasks: [fx.listItem], metrics: { [fx.taskId]: fx.metrics } });
    const { container, findByText } = render(<App />);
    await findByText('1 · Current amplification');

    await waitFor(() => {
      const amp = container.querySelector('#view-amp')?.textContent ?? '';
      expect(amp).toContain('選択 thread: 915');
      // the thread group reports 不明, not 0 / 0
      expect(amp).toContain('不明');
      expect(amp).not.toMatch(/選択 thread: 915[\s\S]*0 \/ 0/);
    });
  });

  it('cache read share is 不明 when cache_read was not reported, not 0.0%', async () => {
    const fx = fixture();
    for (const r of fx.metrics.requestRows) {
      if (r.threadExternalId === '915') r.cacheReadInputTokens = null; // input etc. kept
    }
    go(`task=${fx.taskId}&filter=thread&thread=915`);
    stubFetch({ tasks: [fx.listItem], metrics: { [fx.taskId]: fx.metrics } });
    const { container, findByText } = render(<App />);
    await findByText('1 · Current amplification');

    await waitFor(() => {
      const amp = container.querySelector('#view-amp')?.textContent ?? '';
      // thread 915's only request has no cache_read → share is 不明, never 0.0%
      expect(amp).toMatch(/選択 thread: 915[\s\S]*不明/);
      // task-wide: #1 dropped from the triple → annotated as partial coverage
      expect(amp).toContain('件で算出');
    });
  });

  it('the auto-poll skips a tick while a fetch is still in flight', async () => {
    vi.useFakeTimers();
    try {
      const fx = fixture();
      go(`task=${fx.taskId}`);
      const calls: string[] = [];
      const gate = deferred();
      vi.stubGlobal(
        'fetch',
        makeFetch({
          tasks: [fx.listItem],
          metrics: { [fx.taskId]: fx.metrics },
          calls,
          metricsGate: () => gate.promise,
        })
      );
      render(<App />);
      await vi.advanceTimersByTimeAsync(0);
      const detailCalls = (): number =>
        calls.filter((c) => c.includes(`/api/tasks/${fx.taskId}`)).length;
      const before = detailCalls();
      expect(before).toBeGreaterThan(0); // mount fetch is in flight, gated

      await vi.advanceTimersByTimeAsync(15_000); // three poll intervals elapse
      expect(detailCalls()).toBe(before); // none fired — a load is still running

      gate.resolve();
      await vi.advanceTimersByTimeAsync(6_000);
      expect(detailCalls()).toBeGreaterThan(before); // resumes once it settles
    } finally {
      vi.useRealTimers();
    }
  });

  it('toggles the timeline between minimap and thread lanes', async () => {
    const { container, findByText } = mountSelected();
    await findByText('3 · request 調査');
    switchToTimelineView(container);
    await waitFor(() => expect(container.querySelector('#view-timeline')).toBeTruthy());

    const svgLabel = (): string =>
      container.querySelector('#view-timeline svg')?.getAttribute('aria-label') ?? '';
    expect(svgLabel()).toBe('duplicate context minimap');

    const lanesBtn = [...container.querySelectorAll('#view-timeline .tl-seg button')].find(
      (b) => b.textContent === 'thread lanes'
    ) as HTMLElement;
    lanesBtn.click();
    await waitFor(() => expect(svgLabel()).toBe('duplicate context lanes'));
  });

  it('shows the placeholder with no selection and "not found" for an unknown id', async () => {
    stubFetch({ tasks: [] });
    const empty = render(<App />);
    await empty.findByText(/Select a task/);
    empty.unmount();

    go('task=missing');
    stubFetch({ tasks: [] });
    const unknown = render(<App />);
    await unknown.findByText(/not found/);
  });

  it('clicking a thread cell switches to the thread filter and scopes panel 1', async () => {
    const { container, findByText } = mountSelected();
    await findByText('1 · Current amplification');

    const btn = container.querySelector('#view-requests button[data-thread]') as HTMLElement;
    const threadId = btn.dataset.thread!;
    btn.click();

    await waitFor(() => {
      expect(location.search).toMatch(/filter=thread/);
      expect(location.search).toContain(`thread=${threadId}`);
      expect(
        (container.querySelector('input[name="flt"]:checked') as HTMLInputElement).value
      ).toBe('thread');
      // ADR-0017: thread-scoped values sit in their own group, not inline.
      expect(container.querySelector('#view-amp')?.textContent).toContain(`選択 thread: ${threadId}`);
      // A thread filter already narrows the visible rows to that thread —
      // `sel` must still mark only the selected request, not every row.
      const rows = [...container.querySelectorAll('#view-requests tbody tr')];
      expect(rows.filter((r) => r.className.includes('sel')).length).toBeLessThanOrEqual(1);
    });
  });

  it('every panel offers a filter-aware export link', async () => {
    const { fx, container, findByText } = mountSelected();
    await findByText('1 · Current amplification');

    const href = (id: string): string =>
      container.querySelector(`#${id} .dl a`)!.getAttribute('href')!;

    expect(href('view-amp').endsWith(`/${fx.taskId}/export.json`)).toBe(true);
    expect(href('view-reuse').endsWith(`/${fx.taskId}/blocks.csv`)).toBe(true);
    expect(href('view-requests').endsWith(`/${fx.taskId}/requests.csv`)).toBe(true);

    (container.querySelector('#view-requests button[data-thread]') as HTMLElement).click();
    await waitFor(() => {
      const threadId = location.search.match(/thread=([^&]+)/)![1];
      expect(href('view-amp')).toContain(`export.json?thread=${threadId}`);
      expect(href('view-requests')).toContain(`requests.csv?thread=${threadId}`);
    });
  });

  it("switching tasks never shows the previous task's metrics", async () => {
    const A = fixtureFor('task-A', 3.14);
    const B = fixtureFor('task-B', 9.99);
    const gateB = deferred();
    go('task=task-A');
    vi.stubGlobal(
      'fetch',
      makeFetch({
        tasks: [A.listItem, B.listItem],
        metrics: { 'task-A': A.metrics, 'task-B': B.metrics },
        metricsGate: (id) => (id === 'task-B' ? gateB.promise : Promise.resolve()),
      })
    );
    const { container } = render(<App />);
    const detail = () => container.querySelector('#detail')!.textContent!;
    await waitFor(() => expect(detail()).toContain('3.14x'));

    (container.querySelectorAll('#task-list .task-item')[1] as HTMLElement).click();
    await waitFor(() => expect(detail()).toContain('Loading'));
    expect(detail()).not.toContain('3.14x');

    gateB.resolve();
    await waitFor(() => expect(detail()).toContain('9.99x'));
  });

  it('a late poll response for a deselected task does not clobber the current one', async () => {
    const A = fixtureFor('task-A', 3.14);
    const B = fixtureFor('task-B', 9.99);
    const gateA = deferred();
    go('task=task-A');
    vi.stubGlobal(
      'fetch',
      makeFetch({
        tasks: [A.listItem, B.listItem],
        metrics: { 'task-A': A.metrics, 'task-B': B.metrics },
        metricsGate: (id) => (id === 'task-A' ? gateA.promise : Promise.resolve()),
      })
    );
    const { container } = render(<App />);
    const detail = () => container.querySelector('#detail')!.textContent!;

    await waitFor(() => expect(detail()).toContain('Loading'));
    (container.querySelectorAll('#task-list .task-item')[1] as HTMLElement).click();
    await waitFor(() => expect(detail()).toContain('9.99x'));

    gateA.resolve();
    await new Promise((r) => setTimeout(r, 20));
    expect(detail()).toContain('9.99x');
    expect(detail()).not.toContain('3.14x');
    expect(location.search).toContain('task=task-B');
  });
});
