import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitSystemReminder, splitSystemReminders } from '../src/enrichment/system-reminder.ts';
import { extractProviderBlocks } from '../src/protocol/anthropic-messages.ts';
import type { ExtractedBlock } from '../src/protocol/types.ts';

// --- splitSystemReminder: text -> segments ------------------------

test('splitSystemReminder: no tag -> whole text is application', () => {
  assert.deepEqual(splitSystemReminder('just a normal user message'), [
    { text: 'just a normal user message', contextClass: 'application' },
  ]);
});

test('splitSystemReminder: whole text is a reminder -> protocol', () => {
  const text = '<system-reminder>be careful</system-reminder>';
  assert.deepEqual(splitSystemReminder(text), [{ text, contextClass: 'protocol' }]);
});

test('splitSystemReminder: mixed content -> application / protocol / application', () => {
  const segs = splitSystemReminder(
    'please fix the bug\n<system-reminder>do not add comments</system-reminder>\nthanks'
  );
  assert.ok(segs);
  assert.deepEqual(
    segs.map((s) => s.contextClass),
    ['application', 'protocol', 'application']
  );
});

test('splitSystemReminder: unclosed tag -> null (caller keeps unknown)', () => {
  assert.equal(splitSystemReminder('some text <system-reminder>never closed'), null);
});

// --- splitSystemReminders: block-list enrichment pass ------------

test('splitSystemReminders: an unknown message block with an embedded reminder splits in two', () => {
  const blocks = extractProviderBlocks({
    messages: [{ role: 'user', content: 'real request\n<system-reminder>hidden instruction</system-reminder>' }],
  });
  const out = splitSystemReminders(blocks);
  const msg = out.filter((b) => b.type === 'message');
  assert.equal(msg.length, 2);
  assert.equal(msg[0]!.contextClass, 'application');
  assert.equal(msg[1]!.contextClass, 'protocol');
  assert.equal(msg[0]!.transportRole, 'user');
});

test('splitSystemReminders: no-tag message text becomes application; protocol blocks pass through; seq renumbered', () => {
  const blocks = extractProviderBlocks({
    system: 'sys',
    tools: [{ name: 't', input_schema: {} }],
    messages: [
      { role: 'user', content: 'plain question' },
      { role: 'assistant', content: [{ type: 'tool_use', name: 't', input: {} }] },
    ],
  });
  const out = splitSystemReminders(blocks);
  assert.deepEqual(out.map((b) => b.seq), out.map((_, i) => i));
  assert.equal(out.find((b) => b.type === 'system')?.contextClass, 'protocol');
  assert.equal(out.find((b) => b.type === 'tool_schema')?.contextClass, 'protocol');
  // a plain user-text block with no reminder tag resolves to application
  // (matches the pre-refactor pushTextBlocks behaviour).
  const userText = out.filter((b) => b.type === 'message' && b.transportRole === 'user');
  assert.equal(userText.length, 1);
  assert.equal(userText[0]!.contextClass, 'application');
});

test('splitSystemReminders: an unclosed reminder leaves the block as unknown', () => {
  const blocks: ExtractedBlock[] = [
    { seq: 0, type: 'message', transportRole: 'user', contextClass: 'unknown', text: 'hi <system-reminder>oops' },
  ];
  const out = splitSystemReminders(blocks);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.contextClass, 'unknown');
});
