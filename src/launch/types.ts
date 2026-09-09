import type { ExtractedBlock, ProviderProtocol } from '../protocol/types.ts';
import type { ThreadMarker } from '../enrichment/types.ts';

// Client Launch Adapter (ADR-0009). Everything the launch path needs to know
// that is specific to *which* client CLI is being wrapped — the env var it
// reads for its API base URL, the upstream it talks to, the wire protocol on
// that upstream, and which Client Enrichment to run on the observed traffic.
// `wrap.ts` resolves one of these from the wrapped command and stays otherwise
// provider-agnostic; the proxy and recorder receive it rather than importing
// Anthropic / Claude Code specifics directly.

export interface ClientLaunchProfile {
  id: string; // 'claude-code'

  // Env var the wrapped CLI reads for its API base URL (Claude Code:
  // ANTHROPIC_BASE_URL; Codex would be OPENAI_BASE_URL).
  proxyEnvVar: string;

  // Upstream host the proxy forwards to, and the protocol spoken there.
  targetHost: string;
  protocol: ProviderProtocol;

  // Client Enrichment applied to every observed exchange (ADR-0009). An
  // undefined slot is skipped — the recorder does not assume any client.
  identifyThread?: (systemText: string) => ThreadMarker | null;
  refineBlocks?: (blocks: ExtractedBlock[]) => ExtractedBlock[];
}
