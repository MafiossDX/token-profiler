import type { DatabaseSync } from 'node:sqlite';
import { insertRequest } from './storage/db.ts';
import { ingestExtractedBlocks } from './core/ingest.ts';
import type { ExtractedBlock, NormalizedUsage, ParsedProviderRequest } from './protocol/types.ts';
import type { ThreadMarker } from './enrichment/types.ts';
import type { DebugCaptureConfig } from './types.ts';

// Measurement sink (ADR-0009, light form of the "split transport from
// measurement" seam). The transport layer forwards bytes and then hands one
// observed exchange here; this module owns the compose step —
//   provider protocol output  ->  client enrichment  ->  request row + Core
//   Measurement pipeline
// — and knows nothing about HTTP, SSE, or any provider's wire shape.
//
// Client Enrichment is passed in (from the ClientLaunchProfile), not imported:
// this recorder holds no Claude Code / Anthropic specifics. An absent slot is
// skipped.

export interface ObservedExchange {
  db: DatabaseSync;
  secretHex: string;
  taskId: string;
  agentId: string;
  fingerprintKeyId: string;
  requestId: string;
  requestIndex: number;
  parsed: ParsedProviderRequest;
  usage: NormalizedUsage;
  latencyMs: number;
  startedAt: number;
  // Client Enrichment (ADR-0005/0009). Best-effort — never gates or alters the
  // Core Measurement it feeds.
  identifyThread?: (systemText: string) => ThreadMarker | null;
  refineBlocks?: (blocks: ExtractedBlock[]) => ExtractedBlock[];
  debugCapture?: DebugCaptureConfig | null;
}

export function recordObservedRequest({
  db,
  secretHex,
  taskId,
  agentId,
  fingerprintKeyId,
  requestId,
  requestIndex,
  parsed,
  usage,
  latencyMs,
  startedAt,
  identifyThread,
  refineBlocks,
  debugCapture,
}: ObservedExchange): void {
  const thread = identifyThread ? identifyThread(parsed.systemText) : null;
  const blocks = refineBlocks ? refineBlocks(parsed.blocks) : parsed.blocks;

  insertRequest(db, {
    requestId,
    taskId,
    agentId,
    requestIndex,
    timestamp: new Date(startedAt).toISOString(),
    model: parsed.model,
    provider: parsed.provider,
    operationType: parsed.operationType,
    providerReportedInputTokens: usage.inputTokens,
    providerReportedOutputTokens: usage.outputTokens,
    cacheCreationInputTokens: usage.cacheCreationTokens,
    cacheReadInputTokens: usage.cacheReadTokens,
    latencyMs,
    threadExternalId: thread?.externalSessionId ?? null,
    isSubagent: thread?.isSubagent ?? null,
  });

  ingestExtractedBlocks(db, {
    requestId,
    requestIndex,
    blocks,
    secretHex,
    fingerprintKeyId,
    debugCapture,
  });
}
