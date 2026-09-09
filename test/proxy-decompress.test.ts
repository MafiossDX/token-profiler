import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { decompressBody } from '../src/proxy/decompress.ts';

const PAYLOAD = Buffer.from(JSON.stringify({ usage: { input_tokens: 7, output_tokens: 8 } }));

test('decompressBody: gzip / br / deflate are decoded', () => {
  assert.deepEqual(decompressBody(zlib.gzipSync(PAYLOAD), { 'content-encoding': 'gzip' }), PAYLOAD);
  assert.deepEqual(decompressBody(zlib.brotliCompressSync(PAYLOAD), { 'content-encoding': 'br' }), PAYLOAD);
  assert.deepEqual(decompressBody(zlib.deflateSync(PAYLOAD), { 'content-encoding': 'deflate' }), PAYLOAD);
});

test('decompressBody: no / unknown encoding passes bytes through unchanged', () => {
  assert.equal(decompressBody(PAYLOAD, {}), PAYLOAD);
  assert.equal(decompressBody(PAYLOAD, { 'content-encoding': 'identity' }), PAYLOAD);
});

test('decompressBody: corrupt body for the declared encoding falls back to raw bytes', () => {
  const garbage = Buffer.from('not actually gzip');
  assert.equal(decompressBody(garbage, { 'content-encoding': 'gzip' }), garbage);
});
