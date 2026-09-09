import crypto from 'node:crypto';

// Exact Fingerprint (CONTEXT.md): HMAC-SHA256(local_secret, normalized_chunk).
// Non-reversible, keyed by an installation-local secret to resist dictionary
// attacks. Only ever compared for equality within the same Fingerprint Key Epoch.
export const FINGERPRINT_ALGORITHM = 'hmac-sha256';
export const FINGERPRINT_VERSION = 'v1';

export function exactFingerprint(secretHex: string, normalizedChunkBuf: Buffer): string {
  return crypto.createHmac('sha256', Buffer.from(secretHex, 'hex')).update(normalizedChunkBuf).digest('hex');
}

// Block Fingerprint (ADR-0010): same primitive, applied to a whole
// StructuralBlock instead of a ContentChunk. Kept as a distinct function name
// so call sites can't accidentally conflate the two granularities.
export function blockFingerprint(secretHex: string, normalizedBlockBuf: Buffer): string {
  return crypto.createHmac('sha256', Buffer.from(secretHex, 'hex')).update(normalizedBlockBuf).digest('hex');
}
