// Presentation formatting for the localhost UI. Byte-basis numbers, en-US
// grouping, wall-clock time in the viewer's local zone (ui-review §4). No
// interpretation — these only format Fact-layer values (ADR-0014).

export const grp = (n: number | null | undefined): string =>
  n == null ? 'n/a' : Number(n).toLocaleString('en-US');

export const bytes = (n: number | null | undefined): string =>
  n == null ? 'n/a' : grp(n) + ' B';

export const pct = (x: number | null | undefined): string =>
  x == null ? 'n/a' : (x * 100).toFixed(1) + '%';

export const ratio = (x: number | null | undefined): string =>
  x == null ? 'n/a' : x.toFixed(2) + 'x';

// Format a millisecond span as h/m/s. Blank for a negative or non-finite input
// so callers can fall back to a placeholder.
export function durMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  let s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  return (h ? h + 'h' : '') + (h || m ? m + 'm' : '') + s + 's';
}

export function dur(a: string | null | undefined, b: string | null | undefined): string {
  if (!a || !b) return '';
  return durMs(new Date(b).getTime() - new Date(a).getTime());
}

export function clock(iso: string | null | undefined): string {
  return iso ? new Date(iso).toTimeString().slice(0, 8) : '—';
}

export function nowClock(): string {
  return new Date().toTimeString().slice(0, 8);
}
