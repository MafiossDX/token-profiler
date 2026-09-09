import path from 'node:path';
import { anthropicMessagesProtocol } from '../protocol/anthropic-messages.ts';
import { identifyThread } from '../enrichment/claude-code.ts';
import { splitSystemReminders } from '../enrichment/system-reminder.ts';
import type { ClientLaunchProfile } from './types.ts';

// Claude Code on the Anthropic Messages API. Also the fallback for an
// unrecognised wrapped command: v0 targets Claude Code only (spec §27 Phase 1),
// and `wrap` has always injected ANTHROPIC_BASE_URL for whatever it launched —
// this keeps that behaviour, just no longer implicitly.
export const claudeCodeProfile: ClientLaunchProfile = {
  id: 'claude-code',
  proxyEnvVar: 'ANTHROPIC_BASE_URL',
  targetHost: 'api.anthropic.com',
  protocol: anthropicMessagesProtocol,
  identifyThread,
  refineBlocks: splitSystemReminders,
};

const PROFILES: ClientLaunchProfile[] = [claudeCodeProfile];

// command basename -> profile id. `claude`, `/usr/local/bin/claude`,
// `claude.cmd` all map to claude-code.
const BY_COMMAND: Record<string, string> = {
  claude: 'claude-code',
};

export interface LaunchResolution {
  profile: ClientLaunchProfile;
  // false when the command was not recognised and the default profile was used.
  matched: boolean;
}

export function resolveLaunchProfile(cmd: string): LaunchResolution {
  // path.win32.basename treats both `/` and `\` as separators on every
  // platform, so a bare command, a POSIX path, and a Windows path all resolve
  // the same way whether the CI runner is Linux or Windows.
  const base = path.win32
    .basename(cmd)
    .replace(/\.(cmd|exe|bat|ps1)$/i, '')
    .toLowerCase();
  const id = BY_COMMAND[base];
  const profile = id ? PROFILES.find((p) => p.id === id) : undefined;
  return profile ? { profile, matched: true } : { profile: claudeCodeProfile, matched: false };
}
