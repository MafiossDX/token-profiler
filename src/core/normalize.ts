// Measurement Profile: normalization_version "v1".
// v1 rule: normalize line endings to LF, apply Unicode NFC. Nothing else —
// no whitespace collapsing, no trimming, since that would discard real bytes
// that were actually transported (CONTEXT.md Measurement Profile / one-way door).
export const NORMALIZATION_VERSION = 'v1';

export function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').normalize('NFC');
}
