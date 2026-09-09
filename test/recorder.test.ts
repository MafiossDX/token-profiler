import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { MEASUREMENT_PROFILE_V1 } from '../src/core/ingest.ts';
import { openDb, ensureMeasurementProfile, insertTask, insertAgent } from '../src/storage/db.ts';
import { recordObservedRequest } from '../src/recorder.ts';
import { claudeCodeProfile } from '../src/launch/profiles.ts';
import type { ParsedProviderRequest, NormalizedUsage } from '../src/protocol/types.ts';

// The #1 + #3 join point: protocol output + a launch profile's enrichment set
// -> one request row + the Core Measurement pipeline. Enrichment is injected,
// not imported — the recorder holds no client specifics.

function seed(): { db: DatabaseSync; taskId: string; agentId: string } {
  const db = openDb(':memory:');
  ensureMeasurementProfile(db, MEASUREMENT_PROFILE_V1);
  const taskId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  insertTask(db, { taskId, createdAt: new Date().toISOString(), measurementProfileId: MEASUREMENT_PROFILE_V1.id, fingerprintKeyId: 'k' });
  insertAgent(db, { agentId, taskId, agentRole: null, createdAt: new Date().toISOString() });
  return { db, taskId, agentId };
}

const USAGE: NormalizedUsage = {
  inputTokens: 120,
  outputTokens: 8,
  cacheCreationTokens: 5,
  cacheReadTokens: 90,
};

function parsed(over: Partial<ParsedProviderRequest> = {}): ParsedProviderRequest {
  return {
    provider: 'anthropic',
    operationType: 'messages',
    model: 'claude-test',
    systemText: '',
    blocks: [{ seq: 0, type: 'message', transportRole: 'user', contextClass: 'unknown', text: 'hello world' }],
    ...over,
  };
}

function record(
  db: DatabaseSync,
  taskId: string,
  agentId: string,
  over: Partial<Parameters<typeof recordObservedRequest>[0]> = {}
): void {
  recordObservedRequest({
    db,
    secretHex: crypto.randomBytes(32).toString('hex'),
    taskId,
    agentId,
    fingerprintKeyId: 'test-epoch',
    requestId: crypto.randomUUID(),
    requestIndex: 0,
    parsed: parsed(),
    usage: USAGE,
    latencyMs: 42,
    startedAt: Date.now(),
    ...over,
  });
}

test('recordObservedRequest: writes one request row with normalized usage mapped to columns', () => {
  const { db, taskId, agentId } = seed();
  record(db, taskId, agentId);

  const row = db.prepare('SELECT * FROM requests').get() as Record<string, unknown>;
  assert.equal(row.provider, 'anthropic');
  assert.equal(row.operation_type, 'messages');
  assert.equal(row.model, 'claude-test');
  assert.equal(row.provider_reported_input_tokens, 120);
  assert.equal(row.provider_reported_output_tokens, 8);
  assert.equal(row.cache_creation_input_tokens, 5);
  assert.equal(row.cache_read_input_tokens, 90);
  assert.equal(row.latency_ms, 42);
  db.close();
});

test('recordObservedRequest: identifyThread from the profile populates thread columns; absent -> NULL', () => {
  const marker =
    'x-anthropic-billing-header: cc_version=2.1.251.b8b; cc_entrypoint=sdk-cli; cc_is_subagent=true;\nYou are ...';

  const a = seed();
  record(a.db, a.taskId, a.agentId, {
    parsed: parsed({ systemText: marker }),
    identifyThread: claudeCodeProfile.identifyThread,
  });
  const withEnrich = a.db.prepare('SELECT thread_external_id, is_subagent FROM requests').get() as {
    thread_external_id: string | null;
    is_subagent: number | null;
  };
  assert.equal(withEnrich.thread_external_id, 'b8b');
  assert.equal(withEnrich.is_subagent, 1);
  a.db.close();

  const b = seed();
  record(b.db, b.taskId, b.agentId, { parsed: parsed({ systemText: marker }) }); // no identifyThread
  const noEnrich = b.db.prepare('SELECT thread_external_id, is_subagent FROM requests').get() as {
    thread_external_id: string | null;
    is_subagent: number | null;
  };
  assert.equal(noEnrich.thread_external_id, null);
  assert.equal(noEnrich.is_subagent, null);
  b.db.close();
});

test('recordObservedRequest: refineBlocks from the profile splits a <system-reminder> block', () => {
  const withReminder = parsed({
    blocks: [
      {
        seq: 0,
        type: 'message',
        transportRole: 'user',
        contextClass: 'unknown',
        text: 'do the task\n<system-reminder>be careful</system-reminder>',
      },
    ],
  });

  const a = seed();
  record(a.db, a.taskId, a.agentId, { parsed: withReminder, refineBlocks: claudeCodeProfile.refineBlocks });
  const classes = (a.db.prepare('SELECT context_class FROM structural_blocks ORDER BY seq').all() as { context_class: string }[])
    .map((r) => r.context_class);
  assert.deepEqual(classes, ['application', 'protocol']);
  a.db.close();

  const b = seed();
  record(b.db, b.taskId, b.agentId, { parsed: withReminder }); // no refineBlocks
  const raw = (b.db.prepare('SELECT context_class FROM structural_blocks').all() as { context_class: string }[])
    .map((r) => r.context_class);
  assert.deepEqual(raw, ['unknown']);
  b.db.close();
});
