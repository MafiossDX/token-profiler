import type { DatabaseSync } from 'node:sqlite';
import {
  extractProviderBlocks,
  type MessagesRequestBody,
} from '../src/protocol/anthropic-messages.ts';
import { splitSystemReminders } from '../src/enrichment/system-reminder.ts';
import { ingestExtractedBlocks } from '../src/core/ingest.ts';
import type { ExtractedBlock } from '../src/protocol/types.ts';

// Test-only convenience: the compose step the recorder does in production —
// Anthropic body -> provider protocol blocks -> enrichment reminder split.
// Keeps the many "ingest a whole request body" fixtures short without
// re-coupling core/ingest.ts to the layers above it.

export function extractBlocks(body: MessagesRequestBody): ExtractedBlock[] {
  return splitSystemReminders(extractProviderBlocks(body));
}

export function ingestBody(
  db: DatabaseSync,
  args: {
    requestId: string;
    requestIndex?: number;
    requestBody: MessagesRequestBody;
    secretHex: string;
    fingerprintKeyId: string;
  }
): void {
  const { requestBody, ...rest } = args;
  ingestExtractedBlocks(db, { ...rest, blocks: extractBlocks(requestBody) });
}
