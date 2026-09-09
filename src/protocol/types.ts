// Provider Protocol layer (ADR-0009, 3-layer stack). Everything that knows the
// *shape* of a specific provider's wire protocol — request body, response
// usage, SSE events, and how to turn provider-specific content into
// measurement-neutral blocks — lives behind this interface. Transport
// (HTTP/SSE forwarding) sits below; Client Enrichment (Claude Code / Codex
// identity, <system-reminder> interpretation) sits above and consumes the
// neutral output. Core Measurement (normalize/chunk/fingerprint) never imports
// a provider protocol.

import type { IncomingHttpHeaders } from 'node:http';
import type { BlockType, ContextClass, TransportRole } from '../types.ts';

// A measurement-neutral block extracted from a provider request. The provider
// protocol assigns a provisional contextClass; message-text blocks it cannot
// classify are emitted as 'unknown' for the enrichment layer to split/refine.
export interface ExtractedBlock {
  seq: number;
  type: BlockType;
  transportRole: TransportRole;
  contextClass: ContextClass;
  text: string;
}

// Provider-reported token accounting, mapped to neutral names. null means the
// provider did not report that field for this exchange.
export interface NormalizedUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
}

// One observed request as the transport layer saw it. The protocol decides
// from method + path (+ content-type) whether this is its shape at all before
// it touches the body — so a plain JSON POST to some other endpoint is not
// mistaken for a Messages request.
export interface ProviderRequest {
  method: string | undefined;
  path: string; // upstream path incl. any query string, e.g. /v1/messages?beta=true
  headers: IncomingHttpHeaders;
  body: Buffer;
}

// The result of reading one provider request: enough to record the request row
// and feed the measurement pipeline, with no provider-specific shape left in it.
export interface ParsedProviderRequest {
  provider: string; // 'anthropic'
  operationType: string; // 'messages'
  model: string | null;
  // Raw system-prompt text, for enrichment adapters (identifyThread) — a plain
  // string, not the provider's system field shape.
  systemText: string;
  blocks: ExtractedBlock[];
}

export interface ProviderProtocol {
  readonly id: string; // 'anthropic-messages'
  // Returns null when the request is not this protocol's shape (wrong method /
  // path / content-type) or the body is absent or unparseable — the caller
  // forwards it unchanged and records nothing.
  parseRequest(req: ProviderRequest): ParsedProviderRequest | null;
  // `responseBuf` is already content-decoded by the transport layer
  // (src/proxy/decompress.ts); `headers` is still passed for content-type
  // (JSON vs SSE) detection.
  extractUsage(responseBuf: Buffer, headers: IncomingHttpHeaders): NormalizedUsage;
}
