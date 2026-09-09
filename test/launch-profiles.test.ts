import { test } from 'node:test';
import assert from 'node:assert/strict';

import { claudeCodeProfile, resolveLaunchProfile } from '../src/launch/profiles.ts';

test('resolveLaunchProfile: `claude` and its path / extension variants map to claude-code', () => {
  for (const cmd of ['claude', '/usr/local/bin/claude', 'C:\\Program Files\\claude\\claude.cmd', 'CLAUDE.EXE']) {
    const { profile, matched } = resolveLaunchProfile(cmd);
    assert.equal(matched, true, cmd);
    assert.equal(profile.id, 'claude-code', cmd);
  }
});

test('resolveLaunchProfile: an unrecognised command falls back to claude-code (matched=false)', () => {
  const { profile, matched } = resolveLaunchProfile('codex');
  assert.equal(matched, false);
  assert.equal(profile.id, 'claude-code'); // v0 default — wrap has always injected ANTHROPIC_BASE_URL
});

test('claudeCodeProfile: carries the Anthropic launch wiring and Claude Code enrichment', () => {
  assert.equal(claudeCodeProfile.proxyEnvVar, 'ANTHROPIC_BASE_URL');
  assert.equal(claudeCodeProfile.targetHost, 'api.anthropic.com');
  assert.equal(claudeCodeProfile.protocol.id, 'anthropic-messages');
  assert.equal(typeof claudeCodeProfile.identifyThread, 'function');
  assert.equal(typeof claudeCodeProfile.refineBlocks, 'function');
});
