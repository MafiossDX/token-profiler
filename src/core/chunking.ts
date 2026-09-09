import type { ChunkParams } from '../types.ts';

// Content-Defined Chunking (ContentChunk, Level 2, CONTEXT.md).
// Gear-hash CDC: a chunk boundary occurs where a rolling hash over the gear
// table hits a mask, so insertions/deletions only perturb the chunks touching
// the edit, not everything downstream (unlike fixed-length chunking).
//
// The gear table MUST be deterministic across machines/runs — chunk
// boundaries (and therefore Exact Fingerprints) must be reproducible, which
// is the whole point of chunking_algorithm/chunking_version being tracked in
// the Measurement Profile. It is seeded with a fixed constant, not Math.random().
export const CHUNKING_ALGORITHM = 'gear-cdc-simple';
export const CHUNKING_VERSION = 'v1';

export const DEFAULT_CHUNK_PARAMS: ChunkParams = { min: 256, avg: 1024, max: 4096 };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GEAR_SEED = 0x746b6663; // 'tkfc' — fixed, do not change without bumping CHUNKING_VERSION
const GEAR: Uint32Array = (() => {
  const rand = mulberry32(GEAR_SEED);
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    table[i] = (rand() * 0xffffffff) >>> 0;
  }
  return table;
})();

/** Split a Buffer into content-defined chunks. */
export function chunk(buf: Buffer, params: ChunkParams = DEFAULT_CHUNK_PARAMS): Buffer[] {
  const { min, avg, max } = params;
  if (buf.length === 0) return [];
  if (buf.length <= min) return [buf];

  const maskBits = Math.round(Math.log2(avg));
  const mask = (1 << maskBits) - 1;

  const chunks: Buffer[] = [];
  let start = 0;
  let hash = 0;

  for (let i = 0; i < buf.length; i++) {
    hash = ((hash << 1) + GEAR[buf[i]!]!) >>> 0;
    const size = i - start + 1;
    if (size >= max) {
      chunks.push(buf.subarray(start, i + 1));
      start = i + 1;
      hash = 0;
      continue;
    }
    if (size >= min && (hash & mask) === 0) {
      chunks.push(buf.subarray(start, i + 1));
      start = i + 1;
      hash = 0;
    }
  }
  if (start < buf.length) chunks.push(buf.subarray(start));
  return chunks;
}
