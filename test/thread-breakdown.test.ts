import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { MEASUREMENT_PROFILE_V1 } from '../src/core/ingest.ts';
import { computeTaskMetrics } from '../src/core/metrics.ts';
import { openDb, ensureMeasurementProfile, insertTask, insertAgent, insertRequest } from '../src/storage/db.ts';
import type { MessagesRequestBody } from '../src/protocol/anthropic-messages.ts';
import { ingestBody } from './support.ts';

// Conversation Thread breakdown (ADR-0005/0009/0013): requests.thread_external_id
// is populated by the recorder (src/recorder.ts, via
// src/enrichment/claude-code.ts) BEFORE insertRequest — these tests exercise
// storage + metrics grouping directly, independent of the adapter's own
// unit tests (test/enrichment-claude-code.test.ts).

function makeTestDb(): DatabaseSync {
  const db = openDb(':memory:');
  ensureMeasurementProfile(db, MEASUREMENT_PROFILE_V1);
  return db;
}

function minimalBody(): MessagesRequestBody {
  return { model: 'claude-test', system: 'hello', messages: [{ role: 'user', content: 'hi' }] };
}

test('insertRequest: threadExternalId/isSubagent are optional (backward compatible)', () => {
  const db = makeTestDb();
  const taskId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  insertTask(db, { taskId, createdAt: new Date().toISOString(), measurementProfileId: MEASUREMENT_PROFILE_V1.id, fingerprintKeyId: 'k' });
  insertAgent(db, { agentId, taskId, agentRole: null, createdAt: new Date().toISOString() });

  const requestId = crypto.randomUUID();
  // No threadExternalId/isSubagent passed at all — must not throw, must store NULL.
  insertRequest(db, { requestId, taskId, agentId, requestIndex: 0, timestamp: new Date().toISOString(), model: 'claude-test', provider: 'anthropic' });

  const row = db.prepare('SELECT thread_external_id, is_subagent FROM requests WHERE request_id = ?').get(requestId) as {
    thread_external_id: string | null;
    is_subagent: number | null;
  };
  assert.equal(row.thread_external_id, null);
  assert.equal(row.is_subagent, null);
  db.close();
});

test('computeTaskMetrics: threadBreakdown groups requests by thread_external_id', () => {
  const db = makeTestDb();
  const secretHex = crypto.randomBytes(32).toString('hex');
  const fingerprintKeyId = 'test-epoch';
  const taskId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  insertTask(db, { taskId, createdAt: new Date().toISOString(), measurementProfileId: MEASUREMENT_PROFILE_V1.id, fingerprintKeyId });
  insertAgent(db, { agentId, taskId, agentRole: null, createdAt: new Date().toISOString() });

  const rows: Array<{
    requestIndex: number;
    threadExternalId: string | null;
    isSubagent: boolean | null;
    inputTokens: number;
    outputTokens: number;
  }> = [
    { requestIndex: 0, threadExternalId: '708', isSubagent: false, inputTokens: 100, outputTokens: 10 },
    { requestIndex: 1, threadExternalId: 'b8b', isSubagent: true, inputTokens: 90, outputTokens: 9 },
    { requestIndex: 2, threadExternalId: '708', isSubagent: false, inputTokens: 120, outputTokens: 12 },
    { requestIndex: 3, threadExternalId: null, isSubagent: null, inputTokens: 50, outputTokens: 5 }, // marker absent
  ];
  for (const r of rows) {
    const requestId = crypto.randomUUID();
    insertRequest(db, {
      requestId,
      taskId,
      agentId,
      requestIndex: r.requestIndex,
      timestamp: new Date().toISOString(),
      model: 'claude-test',
      provider: 'anthropic',
      providerReportedInputTokens: r.inputTokens,
      providerReportedOutputTokens: r.outputTokens,
      threadExternalId: r.threadExternalId,
      isSubagent: r.isSubagent,
    });
    ingestBody(db, { requestId, requestIndex: r.requestIndex, requestBody: minimalBody(), secretHex, fingerprintKeyId });
  }

  const metrics = computeTaskMetrics(db, taskId);
  assert.equal(metrics.threadBreakdown.length, 3, 'two named threads + one unknown group');

  const byId = Object.fromEntries(metrics.threadBreakdown.map((t) => [String(t.threadExternalId), t] as const));
  assert.equal(byId['708']!.requestCount, 2);
  assert.equal(byId['708']!.inputTokens, 220);
  assert.equal(byId['708']!.isSubagent, false);

  assert.equal(byId['b8b']!.requestCount, 1);
  assert.equal(byId['b8b']!.isSubagent, true);

  assert.equal(byId['null']!.requestCount, 1);
  assert.equal(byId['null']!.isSubagent, null);

  db.close();
});
