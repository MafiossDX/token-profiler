import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  parseDebugCaptureFilter,
  matchCapture,
  captureChunk,
  listDebugCaptures,
  purgeDebugCaptures,
} from '../src/debug-capture.ts';

// --- parseDebugCaptureFilter -------------------------------------------

test('parseDebugCaptureFilter: single clause', () => {
  const filters = parseDebugCaptureFilter('system:first:2048');
  assert.deepEqual(filters, [{ blockType: 'system', chunkSelector: 'first', maxBytes: 2048 }]);
});

test('parseDebugCaptureFilter: comma-separated clauses', () => {
  const filters = parseDebugCaptureFilter('system:first:2048,message:last:512');
  assert.deepEqual(filters, [
    { blockType: 'system', chunkSelector: 'first', maxBytes: 2048 },
    { blockType: 'message', chunkSelector: 'last', maxBytes: 512 },
  ]);
});

test('parseDebugCaptureFilter: numeric chunk selector', () => {
  const filters = parseDebugCaptureFilter('*:3:100');
  assert.deepEqual(filters, [{ blockType: '*', chunkSelector: 3, maxBytes: 100 }]);
});

test('parseDebugCaptureFilter: throws on empty spec', () => {
  assert.throws(() => parseDebugCaptureFilter(''), /must not be empty/);
});

test('parseDebugCaptureFilter: throws on missing maxBytes', () => {
  assert.throws(() => parseDebugCaptureFilter('system:first'), /want blockType:chunkSelector:maxBytes/);
});

test('parseDebugCaptureFilter: throws on non-positive maxBytes', () => {
  assert.throws(() => parseDebugCaptureFilter('system:first:0'), /positive integer/);
  assert.throws(() => parseDebugCaptureFilter('system:first:-5'), /positive integer/);
});

test('parseDebugCaptureFilter: throws on unknown chunk selector', () => {
  assert.throws(() => parseDebugCaptureFilter('system:middle:100'), /chunkSelector must be/);
});

// --- matchCapture --------------------------------------------------------

test('matchCapture: "first" matches only chunkSeq 0', () => {
  const filters = parseDebugCaptureFilter('system:first:100');
  assert.ok(matchCapture(filters, { blockType: 'system', chunkSeq: 0, isLastChunk: false }));
  assert.equal(matchCapture(filters, { blockType: 'system', chunkSeq: 1, isLastChunk: false }), null);
});

test('matchCapture: "last" matches only when isLastChunk', () => {
  const filters = parseDebugCaptureFilter('system:last:100');
  assert.equal(matchCapture(filters, { blockType: 'system', chunkSeq: 2, isLastChunk: false }), null);
  assert.ok(matchCapture(filters, { blockType: 'system', chunkSeq: 2, isLastChunk: true }));
});

test('matchCapture: numeric selector matches exact seq only', () => {
  const filters = parseDebugCaptureFilter('system:5:100');
  assert.equal(matchCapture(filters, { blockType: 'system', chunkSeq: 4, isLastChunk: false }), null);
  assert.ok(matchCapture(filters, { blockType: 'system', chunkSeq: 5, isLastChunk: false }));
});

test('matchCapture: "*" blockType matches any type', () => {
  const filters = parseDebugCaptureFilter('*:first:100');
  assert.ok(matchCapture(filters, { blockType: 'message', chunkSeq: 0, isLastChunk: false }));
  assert.ok(matchCapture(filters, { blockType: 'system', chunkSeq: 0, isLastChunk: false }));
});

test('matchCapture: mismatched blockType returns null', () => {
  const filters = parseDebugCaptureFilter('system:first:100');
  assert.equal(matchCapture(filters, { blockType: 'message', chunkSeq: 0, isLastChunk: false }), null);
});

// --- captureChunk / listDebugCaptures / purgeDebugCaptures --------------

function makeDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ttp-debug-capture-'));
}

test('captureChunk + listDebugCaptures: round-trip with truncation', () => {
  const dir = makeDir();
  const taskId = 'task-a';

  captureChunk({
    dir,
    taskId,
    requestId: 'req-1',
    requestIndex: 3,
    blockSeq: 0,
    blockType: 'system',
    chunkSeq: 0,
    buf: Buffer.from('short'),
    maxBytes: 100,
  });
  captureChunk({
    dir,
    taskId,
    requestId: 'req-2',
    requestIndex: 4,
    blockSeq: 0,
    blockType: 'system',
    chunkSeq: 0,
    buf: Buffer.from('this is definitely longer than the cap'),
    maxBytes: 10,
  });

  const captures = listDebugCaptures({ dir, taskId });
  assert.equal(captures.length, 2);

  const untruncated = captures.find((c) => c.request_id === 'req-1');
  assert.ok(untruncated);
  assert.equal(untruncated.truncated, false);
  assert.equal(untruncated.byte_length, 5);
  assert.equal(untruncated.captured_bytes, 5);

  const truncated = captures.find((c) => c.request_id === 'req-2');
  assert.ok(truncated);
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.captured_bytes, 10);
  assert.equal(truncated.byte_length, Buffer.from('this is definitely longer than the cap').length);

  const content = fs.readFileSync(path.join(dir, taskId, '4-0-0.txt'), 'utf8');
  assert.equal(content, 'this is de');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('purgeDebugCaptures: removes only the targeted task directory', () => {
  const dir = makeDir();
  captureChunk({ dir, taskId: 'task-a', requestId: 'r1', requestIndex: 0, blockSeq: 0, blockType: 'system', chunkSeq: 0, buf: Buffer.from('x'), maxBytes: 10 });
  captureChunk({ dir, taskId: 'task-b', requestId: 'r2', requestIndex: 0, blockSeq: 0, blockType: 'system', chunkSeq: 0, buf: Buffer.from('y'), maxBytes: 10 });

  const removed = purgeDebugCaptures({ dir, taskId: 'task-a' });
  assert.equal(removed, 1);
  assert.equal(listDebugCaptures({ dir, taskId: 'task-a' }).length, 0);
  assert.equal(listDebugCaptures({ dir, taskId: 'task-b' }).length, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('purgeDebugCaptures: refuses to run without taskId or all', () => {
  const dir = makeDir();
  assert.throws(() => purgeDebugCaptures({ dir }), /requires taskId or all/);
  fs.rmSync(dir, { recursive: true, force: true });
});
