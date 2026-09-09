import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

let seq = 0;

// Shared "❔" toggletip — deliberately NOT the native `title` attribute
// (unreadable on touch, no control over width/wrapping/link content). A
// disclosure-button pattern rather than strict ARIA role="tooltip", because
// the popover can contain a focusable link (role="tooltip" content must not
// be interactive per WAI-ARIA authoring practices).
//
// Opens on hover, keyboard focus, or tap; closes on Escape, or when the
// pointer/focus leaves the wrapper. `text` is the one-sentence definition;
// `href` (optional) is the "詳しい説明" deep link into docs/ui-reading-guide.md
// via docLinks.ts. Never asserts a cause or a fix — callers must keep the
// wording to what was measured and its scope (see docs/ui-reading-guide.md).
export function HelpTip({
  text,
  href,
  label = '詳しい説明',
}: {
  text: string;
  href?: string;
  label?: string;
}): ComponentChildren {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const [above, setAbove] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set by onFocus, consumed once by the click that immediately follows it —
  // a real tap fires focus then click on the same button, and without this
  // the naive click-toggle in onClick would flip the just-opened state back
  // to closed on the very first tap. Auto-clears after a short delay so a
  // later, independent click (not part of the same tap) still toggles
  // normally.
  const justFocusedRef = useRef(false);
  const justFocusedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useRef('helptip-' + ++seq).current;

  const cancelClose = (): void => {
    if (closeTimer.current != null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = (): void => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  const openNow = (): void => {
    cancelClose();
    setOpen(true);
  };
  const clearJustFocused = (): void => {
    if (justFocusedTimer.current != null) {
      clearTimeout(justFocusedTimer.current);
      justFocusedTimer.current = null;
    }
    justFocusedRef.current = false;
  };
  const onIconFocus = (): void => {
    justFocusedRef.current = true;
    if (justFocusedTimer.current != null) clearTimeout(justFocusedTimer.current);
    justFocusedTimer.current = setTimeout(clearJustFocused, 400);
    openNow();
  };
  const onIconClick = (): void => {
    if (justFocusedRef.current) {
      // Same tap that just opened this via focus — swallow the click instead
      // of toggling closed.
      clearJustFocused();
      return;
    }
    setOpen((v) => !v);
  };
  // Shared blur handler for both the icon button and the in-popover link:
  // only close when focus actually leaves the wrapper (relatedTarget is
  // outside it) — tabbing from the button into the "詳しい説明" link stays
  // open. `blur` does not bubble, so this is attached to each focusable
  // element directly rather than to the wrapper.
  const onBlurWithin = (e: FocusEvent): void => {
    const next = e.relatedTarget as Node | null;
    if (next && wrapRef.current?.contains(next)) return;
    setOpen(false);
  };

  // Escape closes while open, and returns focus to the icon button. Uses
  // useLayoutEffect (not useEffect) so the listener is registered
  // synchronously with the open-state change, not deferred to a later tick.
  useLayoutEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // Focus the button first: if it wasn't already focused, this fires
        // its own onFocus (re-opening), so setOpen(false) must come after
        // to be the state that actually sticks.
        wrapRef.current?.querySelector<HTMLButtonElement>('.help-icon')?.focus();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Avoid screen-edge overflow: flip to right/top-aligned when the popover
  // would otherwise clip against the viewport. Measured fresh on every open
  // against the *uncorrected* base position — a previous open may have left
  // the align-right/above classes applied, which shift the rect being
  // measured, so a naive re-measure can wrongly conclude "not overflowing"
  // and drop the correction, causing overflow again. Strip any leftover
  // correction classes directly on the DOM node before measuring (state from
  // the previous open hasn't necessarily been reset by render yet), then
  // reapply based on the fresh measurement — both on the DOM immediately (no
  // flash before the next render) and via state (so subsequent renders agree).
  useLayoutEffect(() => {
    if (!open || !popRef.current) return;
    const el = popRef.current;
    const hadAlignRight = el.classList.contains('align-right');
    const hadAbove = el.classList.contains('above');
    if (hadAlignRight) el.classList.remove('align-right');
    if (hadAbove) el.classList.remove('above');
    const r = el.getBoundingClientRect();
    const overflowRight = r.right > window.innerWidth - 8;
    const overflowBottom = r.bottom > window.innerHeight - 8;
    if (overflowRight) el.classList.add('align-right');
    if (overflowBottom) el.classList.add('above');
    setAlignRight(overflowRight);
    setAbove(overflowBottom);
  }, [open]);

  useLayoutEffect(() => () => {
    cancelClose();
    clearJustFocused();
  }, []);

  return (
    <span class="helptip" ref={wrapRef} onMouseEnter={openNow} onMouseLeave={scheduleClose}>
      <button
        type="button"
        class="help-icon"
        aria-expanded={open}
        aria-controls={id}
        onFocus={onIconFocus}
        onBlur={onBlurWithin}
        onClick={onIconClick}
      >
        ❔
      </button>
      <div
        id={id}
        ref={popRef}
        class={'help-pop' + (alignRight ? ' align-right' : '') + (above ? ' above' : '')}
        hidden={!open}
        onMouseEnter={cancelClose}
      >
        <p>{text}</p>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" onBlur={onBlurWithin}>
            {label} ↗
          </a>
        ) : null}
      </div>
    </span>
  );
}
