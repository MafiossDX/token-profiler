import type { ExtractedBlock } from '../protocol/types.ts';
import type { ContextClass } from '../types.ts';

// System Reminder interpretation (ADR-0009 Client Enrichment layer). Frameworks
// like Claude Code inject <system-reminder>...</system-reminder> instructions
// into otherwise-application user message text (Q10 spike finding). The
// Anthropic Messages API itself has no such concept, so this lives above the
// provider protocol: it takes the neutral 'unknown' message blocks the
// protocol emitted and splits/reclassifies them.
//
// Detection is a plain regex match on the tag — non-reminder text is left
// alone, and an unterminated <system-reminder> (no closing tag) is left
// unclassified (splitSystemReminder returns null), so the caller keeps
// context_class=unknown rather than guessing (ADR-0011 "do not infer meaning").

const REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const UNCLOSED_RE = /<system-reminder>(?![\s\S]*<\/system-reminder>)/;

interface ReminderSegment {
  text: string;
  contextClass: Extract<ContextClass, 'application' | 'protocol'>;
}

/**
 * Splits one text block into application / protocol segments around any
 * <system-reminder> tags. Returns null when the text could not be classified
 * with confidence (caller should keep context_class 'unknown').
 */
export function splitSystemReminder(text: string): ReminderSegment[] | null {
  if (UNCLOSED_RE.test(text)) return null;

  const matches = [...text.matchAll(REMINDER_RE)];
  if (matches.length === 0) {
    return [{ text, contextClass: 'application' }];
  }

  const segments: ReminderSegment[] = [];
  let cursor = 0;
  for (const m of matches) {
    const idx = m.index ?? 0;
    if (idx > cursor) {
      const before = text.slice(cursor, idx);
      if (before.trim().length > 0) segments.push({ text: before, contextClass: 'application' });
    }
    segments.push({ text: m[0], contextClass: 'protocol' });
    cursor = idx + m[0].length;
  }
  if (cursor < text.length) {
    const after = text.slice(cursor);
    if (after.trim().length > 0) segments.push({ text: after, contextClass: 'application' });
  }
  return segments;
}

/**
 * Enrichment pass over a provider protocol's block list: every unclassified
 * ('unknown') message-text block is split around its <system-reminder> tags
 * into application / protocol sub-blocks; everything else passes through
 * untouched. `seq` is renumbered over the final list.
 */
export function splitSystemReminders(blocks: ExtractedBlock[]): ExtractedBlock[] {
  const out: ExtractedBlock[] = [];
  let seq = 0;
  for (const block of blocks) {
    const isUnclassifiedMessageText = block.type === 'message' && block.contextClass === 'unknown';
    if (!isUnclassifiedMessageText) {
      out.push({ ...block, seq: seq++ });
      continue;
    }
    const segments = splitSystemReminder(block.text);
    if (segments === null) {
      out.push({ ...block, seq: seq++ });
      continue;
    }
    for (const seg of segments) {
      out.push({
        seq: seq++,
        type: 'message',
        transportRole: block.transportRole,
        contextClass: seg.contextClass,
        text: seg.text,
      });
    }
  }
  return out;
}
