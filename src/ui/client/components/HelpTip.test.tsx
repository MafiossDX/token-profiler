import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import { HelpTip } from './HelpTip.tsx';

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('HelpTip', () => {
  it('starts closed', () => {
    const { container } = render(<HelpTip text="説明" />);
    const pop = container.querySelector('.help-pop') as HTMLElement;
    expect(pop.hidden).toBe(true);
  });

  it('opens on hover and closes after mouseleave (delayed)', () => {
    vi.useFakeTimers();
    const { container } = render(<HelpTip text="説明" />);
    const wrap = container.querySelector('.helptip') as HTMLElement;
    const pop = container.querySelector('.help-pop') as HTMLElement;

    fireEvent.mouseEnter(wrap);
    expect(pop.hidden).toBe(false);

    fireEvent.mouseLeave(wrap);
    // Not immediately closed — short delay tolerates pointer moving across a
    // small visual gap into the popover.
    expect(pop.hidden).toBe(false);
    // The close fires from a bare setTimeout, outside any fireEvent — wrap
    // the timer advance in act() so Preact's resulting re-render is flushed
    // before we assert on the DOM.
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(pop.hidden).toBe(true);
  });

  it('moving the pointer onto the popover cancels the close', () => {
    vi.useFakeTimers();
    const { container } = render(<HelpTip text="説明" href="https://example.com/doc#a" />);
    const wrap = container.querySelector('.helptip') as HTMLElement;
    const pop = container.querySelector('.help-pop') as HTMLElement;

    fireEvent.mouseEnter(wrap);
    fireEvent.mouseLeave(wrap);
    fireEvent.mouseEnter(pop);
    vi.advanceTimersByTime(150);
    expect(pop.hidden).toBe(false);
  });

  it('opens on keyboard focus and closes on blur to outside the wrapper', () => {
    const { container } = render(<HelpTip text="説明" href="https://example.com/doc#a" />);
    const btn = container.querySelector('.help-icon') as HTMLButtonElement;
    const pop = container.querySelector('.help-pop') as HTMLElement;

    fireEvent.focus(btn);
    expect(pop.hidden).toBe(false);

    fireEvent.blur(btn, { relatedTarget: document.body });
    expect(pop.hidden).toBe(true);
  });

  it('tabbing from the icon into the link inside the popover does not close it', () => {
    const { container } = render(<HelpTip text="説明" href="https://example.com/doc#a" />);
    const btn = container.querySelector('.help-icon') as HTMLButtonElement;
    const link = container.querySelector('.help-pop a') as HTMLAnchorElement;
    const wrap = container.querySelector('.helptip') as HTMLElement;
    const pop = container.querySelector('.help-pop') as HTMLElement;

    fireEvent.focus(btn);
    expect(pop.hidden).toBe(false);
    fireEvent.blur(btn, { relatedTarget: link });
    // relatedTarget is inside the same wrapper — must stay open.
    expect(wrap.contains(link)).toBe(true);
    expect(pop.hidden).toBe(false);
  });

  it('click toggles open/closed (touch equivalent)', () => {
    const { container } = render(<HelpTip text="説明" />);
    const btn = container.querySelector('.help-icon') as HTMLButtonElement;
    const pop = container.querySelector('.help-pop') as HTMLElement;

    fireEvent.click(btn);
    expect(pop.hidden).toBe(false);
    fireEvent.click(btn);
    expect(pop.hidden).toBe(true);
  });

  it('a tap (focus then click, same gesture) does not immediately close', () => {
    const { container } = render(<HelpTip text="説明" />);
    const btn = container.querySelector('.help-icon') as HTMLButtonElement;
    const pop = container.querySelector('.help-pop') as HTMLElement;

    // A real tap on the icon fires focus first, then click, on the same
    // element. The click must not undo the open the focus just caused.
    fireEvent.focus(btn);
    expect(pop.hidden).toBe(false);
    fireEvent.click(btn);
    expect(pop.hidden).toBe(false);

    // A later, independent click (not part of that tap) still toggles.
    fireEvent.click(btn);
    expect(pop.hidden).toBe(true);
  });

  it('re-measures edge alignment against the base position on every open', () => {
    vi.useFakeTimers();
    const { container } = render(<HelpTip text="説明" />);
    const btn = container.querySelector('.help-icon') as HTMLButtonElement;
    const pop = container.querySelector('.help-pop') as HTMLElement;

    // Simulate real layout: the popover overflows the right edge unless the
    // align-right correction is currently applied to it.
    vi.spyOn(pop, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          bottom: 10,
          right: pop.classList.contains('align-right')
            ? window.innerWidth - 50
            : window.innerWidth + 100,
          toJSON: () => ({}),
        }) as DOMRect
    );

    fireEvent.click(btn);
    expect(pop.classList.contains('align-right')).toBe(true);

    fireEvent.click(btn); // close
    act(() => {
      vi.advanceTimersByTime(0);
    });

    // Reopen: must not be fooled by the align-right class left over from the
    // previous open into concluding "no longer overflowing".
    fireEvent.click(btn);
    expect(pop.classList.contains('align-right')).toBe(true);
  });

  it('Escape closes the popover and returns focus to the icon', () => {
    const { container } = render(<HelpTip text="説明" />);
    const btn = container.querySelector('.help-icon') as HTMLButtonElement;
    const pop = container.querySelector('.help-pop') as HTMLElement;

    fireEvent.click(btn);
    expect(pop.hidden).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(pop.hidden).toBe(true);
    expect(document.activeElement).toBe(btn);
  });

  it('renders the given href on the "詳しい説明" link', () => {
    const { container } = render(
      <HelpTip text="説明" href="https://github.com/MafiossDX/token-profiler/blob/main/docs/ui-reading-guide.md#sec-1-current-amplification" />
    );
    const link = container.querySelector('.help-pop a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(
      'https://github.com/MafiossDX/token-profiler/blob/main/docs/ui-reading-guide.md#sec-1-current-amplification'
    );
    expect(link.textContent).toContain('詳しい説明');
  });

  it('omits the link entirely when no href is given', () => {
    const { container } = render(<HelpTip text="説明のみ" />);
    expect(container.querySelector('.help-pop a')).toBeNull();
  });
});
