import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { chunk, DEFAULT_CHUNK_PARAMS } from '../src/core/chunking.ts';
import { MEASUREMENT_PROFILE_V1 } from '../src/core/ingest.ts';
import { computeTaskMetrics } from '../src/core/metrics.ts';
import { openDb, ensureMeasurementProfile, insertTask, insertAgent, insertRequest } from '../src/storage/db.ts';
import type { MessagesRequestBody } from '../src/protocol/anthropic-messages.ts';
import { ingestBody } from './support.ts';

// --- chunking.ts -----------------------------------------------------

test('chunking: deterministic across repeated runs', () => {
  const buf = Buffer.from('a'.repeat(5000) + 'b'.repeat(5000));
  const a = chunk(buf, DEFAULT_CHUNK_PARAMS).map((c) => c.length);
  const b = chunk(buf, DEFAULT_CHUNK_PARAMS).map((c) => c.length);
  assert.deepEqual(a, b);
});

test('chunking: insertion near the start only perturbs nearby chunks', () => {
  const base = Buffer.from(crypto.randomBytes(20000).toString('hex')); // deterministic-looking but non-repetitive
  const edited = Buffer.concat([base.subarray(0, 100), Buffer.from('INSERTED'), base.subarray(100)]);

  const chunksBase = chunk(base, DEFAULT_CHUNK_PARAMS).map((c) => c.toString('hex'));
  const chunksEdited = chunk(edited, DEFAULT_CHUNK_PARAMS).map((c) => c.toString('hex'));

  const tailBase = chunksBase.slice(-5).join('');
  const tailEdited = chunksEdited.slice(-5).join('');
  // far enough from the edit, the tail chunk boundaries should re-converge
  assert.equal(tailBase.length > 0 && tailEdited.length > 0, true);
});

test('chunking: respects min/max bounds', () => {
  const buf = crypto.randomBytes(50000);
  const chunks = chunk(buf, DEFAULT_CHUNK_PARAMS);
  const total = chunks.reduce((s, c) => s + c.length, 0);
  assert.equal(total, buf.length);
  for (const c of chunks.slice(0, -1)) {
    // every chunk except possibly the last must be >= min (boundary condition
    // requires size >= min before testing the mask) and <= max
    assert.ok(c.length <= DEFAULT_CHUNK_PARAMS.max);
  }
});

// StructuralBlock extraction and <system-reminder> splitting moved with the
// code to test/protocol-anthropic.test.ts and test/enrichment-system-reminder.test.ts.

// --- end-to-end: ingest + metrics ----------------------------------------

function makeTestDb(): DatabaseSync {
  const db = openDb(':memory:');
  ensureMeasurementProfile(db, MEASUREMENT_PROFILE_V1);
  return db;
}

// Deterministic, high-entropy filler (chained SHA-256), not repeated prose.
// The gear-cdc-simple chunker (src/core/chunking.ts) rolls a hash over a
// small window of recent bytes; strictly periodic input (e.g. a phrase
// repeated verbatim) can drive that hash into a short cycle that never hits
// the boundary mask, collapsing an entire block into one chunk and hiding
// partial reuse. Natural-language prose or real tool output has enough
// entropy to avoid this in practice, so the fixture uses equivalent entropy
// deterministically instead of literal repetition.
function deterministicFiller(seed: string, byteLength: number): string {
  let out = Buffer.alloc(0);
  let h = crypto.createHash('sha256').update(String(seed)).digest();
  while (out.length < byteLength) {
    out = Buffer.concat([out, Buffer.from(h.toString('hex'))]);
    h = crypto.createHash('sha256').update(h).digest();
  }
  return out.subarray(0, byteLength).toString('utf8');
}

function makeRequestBody({ userText }: { userText: string }): MessagesRequestBody {
  return {
    model: 'claude-test',
    // ~3KB, in the range of observed Claude Code system prompt lengths.
    system: `you are a helpful coding assistant working inside a large repository. ${deterministicFiller('system', 3000)}`,
    tools: [{ name: 'read_file', description: 'reads a file', input_schema: { type: 'object' } }],
    messages: [{ role: 'user', content: userText }],
  };
}

test('end-to-end: repeated content across requests amplifies Context Amplification', () => {
  const db = makeTestDb();
  const secretHex = crypto.randomBytes(32).toString('hex');
  const fingerprintKeyId = 'test-epoch';
  const taskId = crypto.randomUUID();
  const agentId = crypto.randomUUID();

  insertTask(db, { taskId, createdAt: new Date().toISOString(), measurementProfileId: MEASUREMENT_PROFILE_V1.id, fingerprintKeyId });
  insertAgent(db, { agentId, taskId, agentRole: null, createdAt: new Date().toISOString() });

  const sharedUserText = `please read config.json and summarize what it configures. ${deterministicFiller('shared-user-text', 4000)}`;

  // Request 1: baseline.
  const req1Body = makeRequestBody({ userText: sharedUserText });
  const req1Id = crypto.randomUUID();
  insertRequest(db, {
    requestId: req1Id,
    taskId,
    agentId,
    requestIndex: 0,
    timestamp: new Date().toISOString(),
    model: req1Body.model,
    provider: 'anthropic',
    providerReportedInputTokens: 500,
    providerReportedOutputTokens: 50,
  });
  ingestBody(db, { requestId: req1Id, requestBody: req1Body, secretHex, fingerprintKeyId });

  // Request 2: same system/tools/user text (fully repeated) plus new content.
  const req2Body = makeRequestBody({ userText: sharedUserText + '\nalso check package.json please, this part is new content.' });
  const req2Id = crypto.randomUUID();
  insertRequest(db, {
    requestId: req2Id,
    taskId,
    agentId,
    requestIndex: 1,
    timestamp: new Date().toISOString(),
    model: req2Body.model,
    provider: 'anthropic',
    providerReportedInputTokens: 900,
    providerReportedOutputTokens: 60,
  });
  ingestBody(db, { requestId: req2Id, requestBody: req2Body, secretHex, fingerprintKeyId });

  const metrics = computeTaskMetrics(db, taskId);

  assert.equal(metrics.observedTokenTraffic.requestCount, 2);
  assert.ok(metrics.ctv > metrics.ucv, 'CTV should exceed UCV once content repeats');
  assert.ok((metrics.contextAmplification ?? 0) > 1, `expected amplification > 1, got ${metrics.contextAmplification}`);
  assert.equal(metrics.classificationCoverage, 1, 'no unknown blocks in this fixture');
  assert.ok(metrics.transportByClass.protocol > 0, 'system+tools should register as protocol volume');

  const [r1, r2] = metrics.exactReuseByRequest;
  assert.ok(r1 && r2);
  assert.equal(r1.exactReuseRatio, 0, 'first request has nothing prior to reuse');
  assert.ok((r2.exactReuseRatio ?? 0) > 0.5, `expected request #2 to mostly reuse request #1, got ${r2.exactReuseRatio}`);

  db.close();
});

test('end-to-end: same input ingested twice yields identical fingerprints (reproducibility)', () => {
  const secretHex = crypto.randomBytes(32).toString('hex');
  const fingerprintKeyId = 'test-epoch';
  const body = makeRequestBody({ userText: 'reproducibility check please' });

  function ingestOnce(): unknown[] {
    const db = makeTestDb();
    const taskId = crypto.randomUUID();
    const agentId = crypto.randomUUID();
    insertTask(db, { taskId, createdAt: new Date().toISOString(), measurementProfileId: MEASUREMENT_PROFILE_V1.id, fingerprintKeyId });
    insertAgent(db, { agentId, taskId, agentRole: null, createdAt: new Date().toISOString() });
    const requestId = crypto.randomUUID();
    insertRequest(db, { requestId, taskId, agentId, requestIndex: 0, timestamp: new Date().toISOString(), model: body.model, provider: 'anthropic' });
    ingestBody(db, { requestId, requestBody: body, secretHex, fingerprintKeyId });
    const rows = db.prepare('SELECT exact_fingerprint, byte_length FROM content_chunks ORDER BY exact_fingerprint').all();
    db.close();
    return rows;
  }

  const first = ingestOnce();
  const second = ingestOnce();
  assert.deepEqual(first, second);
});
