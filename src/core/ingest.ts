import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { normalize, NORMALIZATION_VERSION } from './normalize.ts';
import { chunk, CHUNKING_ALGORITHM, CHUNKING_VERSION, DEFAULT_CHUNK_PARAMS } from './chunking.ts';
import { exactFingerprint, blockFingerprint, FINGERPRINT_ALGORITHM, FINGERPRINT_VERSION } from './fingerprint.ts';
import { insertStructuralBlock, insertContentChunk } from '../storage/db.ts';
import { matchCapture, captureChunk } from '../debug-capture.ts';
import type { ExtractedBlock } from '../protocol/types.ts';
import type { DebugCaptureConfig, MeasurementProfile } from '../types.ts';

export interface IngestParams {
  requestId: string;
  requestIndex?: number;
  // Measurement-neutral blocks, already extracted by a provider protocol and
  // refined by the enrichment layer. Core Measurement does not read request
  // bodies.
  blocks: ExtractedBlock[];
  secretHex: string;
  fingerprintKeyId: string;
  debugCapture?: DebugCaptureConfig | null;
}

export const MEASUREMENT_PROFILE_V1: MeasurementProfile = {
  id: 'v1',
  normalizationVersion: NORMALIZATION_VERSION,
  chunkingAlgorithm: CHUNKING_ALGORITHM,
  chunkingVersion: CHUNKING_VERSION,
  minSize: DEFAULT_CHUNK_PARAMS.min,
  avgSize: DEFAULT_CHUNK_PARAMS.avg,
  maxSize: DEFAULT_CHUNK_PARAMS.max,
  fingerprintAlgorithm: FINGERPRINT_ALGORITHM,
  fingerprintVersion: FINGERPRINT_VERSION,
};

/**
 * ExtractedBlock -> ContentChunk -> Exact Fingerprint, persisted to the DB.
 * This is the entire provider-independent Deterministic measurement pipeline
 * (ADR-0002/0010/0011); nothing here reads request bodies or raw wire text —
 * blocks arrive already lowered by the provider protocol + enrichment layers.
 */
export function ingestExtractedBlocks(
  db: DatabaseSync,
  { requestId, requestIndex, blocks, secretHex, fingerprintKeyId, debugCapture }: IngestParams
): void {
  for (const block of blocks) {
    const normalizedText = normalize(block.text);
    const normalizedBuf = Buffer.from(normalizedText, 'utf8');
    const blockId = crypto.randomUUID();
    const bf = blockFingerprint(secretHex, normalizedBuf);

    insertStructuralBlock(db, {
      blockId,
      requestId,
      seq: block.seq,
      type: block.type,
      transportRole: block.transportRole,
      contextClass: block.contextClass,
      blockFingerprint: bf,
      byteLength: normalizedBuf.length,
    });

    const chunks = chunk(normalizedBuf, DEFAULT_CHUNK_PARAMS);
    chunks.forEach((chunkBuf, idx) => {
      const ef = exactFingerprint(secretHex, chunkBuf);
      insertContentChunk(db, {
        chunkId: crypto.randomUUID(),
        blockId,
        requestId,
        seq: idx,
        byteLength: chunkBuf.length,
        exactFingerprint: ef,
        fingerprintKeyId,
      });

      // Targeted debug row capture (opt-in, ADR-0012) — no-op unless the
      // caller (wrap --debug-capture-filter) explicitly enabled it.
      if (debugCapture) {
        const isLastChunk = idx === chunks.length - 1;
        const filter = matchCapture(debugCapture.filters, { blockType: block.type, chunkSeq: idx, isLastChunk });
        if (filter) {
          captureChunk({
            dir: debugCapture.dir,
            taskId: debugCapture.taskId,
            requestId,
            requestIndex: requestIndex ?? 0,
            blockSeq: block.seq,
            blockType: block.type,
            chunkSeq: idx,
            buf: chunkBuf,
            maxBytes: filter.maxBytes,
          });
        }
      }
    });
  }
}
