import { test } from 'node:test';
import assert from 'node:assert/strict';

import { identifyThread, capabilities } from '../src/enrichment/claude-code.ts';

// identifyThread takes the already-extracted system-prompt text (a plain
// string). Turning the Anthropic `system` field shape into that string is the
// provider protocol's job (see test/protocol-anthropic.test.ts).

test('identifyThread: matches marker with cc_is_subagent', () => {
  const system =
    'x-anthropic-billing-header: cc_version=2.1.251.b8b; cc_entrypoint=sdk-cli; cc_is_subagent=true;\n' +
    "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
  assert.deepEqual(identifyThread(system), {
    externalSessionId: 'b8b',
    ccVersion: '2.1.251',
    entrypoint: 'sdk-cli',
    isSubagent: true,
  });
});

test('identifyThread: matches marker without cc_is_subagent (isSubagent null)', () => {
  const system =
    'x-anthropic-billing-header: cc_version=2.1.251.708; cc_entrypoint=sdk-cli;\n' +
    'You are an interactive agent that helps users with software engineering tasks.';
  assert.deepEqual(identifyThread(system), {
    externalSessionId: '708',
    ccVersion: '2.1.251',
    entrypoint: 'sdk-cli',
    isSubagent: null,
  });
});

test('identifyThread: returns null when marker is absent', () => {
  assert.equal(identifyThread('You are a helpful assistant.'), null);
});

test('identifyThread: returns null when the text is empty', () => {
  assert.equal(identifyThread(''), null);
});

test('identifyThread: returns null when marker only appears later in the text (not at start)', () => {
  const system = 'You are a helpful assistant.\nx-anthropic-billing-header: cc_version=1.0.0.xyz; cc_entrypoint=sdk-cli;';
  assert.equal(identifyThread(system), null);
});

test('capabilities: declares thread_identity and subagent_identity with confidence x availability', () => {
  assert.equal(capabilities.thread_identity!.availability, 'available');
  assert.equal(capabilities.thread_identity!.confidence, 'verified_best_effort');
  assert.equal(capabilities.subagent_identity!.availability, 'available');
  assert.equal(capabilities.subagent_identity!.confidence, 'discovered_unverified');
});
