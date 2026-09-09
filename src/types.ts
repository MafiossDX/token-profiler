// Shared type model for Core Measurement: the neutral block vocabulary, DB row
// shapes, computeTaskMetrics output, and debug-capture structures. Layer-local
// contracts live with their layer — provider request/usage/block types in
// src/protocol/types.ts, enrichment output + capability types in
// src/enrichment/types.ts.

// --- Measurement Profile ------------------------------------------------

export interface MeasurementProfile {
  id: string;
  normalizationVersion: string;
  chunkingAlgorithm: string;
  chunkingVersion: string;
  minSize: number;
  avgSize: number;
  maxSize: number;
  fingerprintAlgorithm: string;
  fingerprintVersion: string;
}

export interface ChunkParams {
  min: number;
  avg: number;
  max: number;
}

// --- StructuralBlock / context classification --------------------------
// Neutral measurement vocabulary shared by the provider protocol (producer),
// the enrichment layer (refiner), and Core Measurement / storage (consumer).
// The ExtractedBlock shape itself lives in src/protocol/types.ts.

export type ContextClass = 'application' | 'protocol' | 'unknown';
export type BlockType = 'system' | 'tool_schema' | 'message' | 'tool_result';
export type TransportRole = 'user' | 'assistant' | null;

// --- DB row inserts (camelCase in JS, snake_case in SQLite) ------------

export interface TaskInsert {
  taskId: string;
  createdAt: string;
  measurementProfileId: string;
  fingerprintKeyId: string;
}

export interface AgentInsert {
  agentId: string;
  taskId: string;
  agentRole: string | null;
  createdAt: string;
}

export interface RequestInsert {
  requestId: string;
  taskId: string;
  agentId: string;
  requestIndex: number;
  timestamp: string;
  model?: string | null;
  provider: string;
  operationType?: string | null;
  providerReportedInputTokens?: number | null;
  providerReportedOutputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  latencyMs?: number | null;
  threadExternalId?: string | null;
  isSubagent?: boolean | null;
}

export interface StructuralBlockInsert {
  blockId: string;
  requestId: string;
  seq: number;
  type: string;
  transportRole?: string | null;
  contextClass: ContextClass;
  blockFingerprint: string;
  byteLength: number;
}

export interface ContentChunkInsert {
  chunkId: string;
  blockId: string;
  requestId: string;
  seq: number;
  byteLength: number;
  exactFingerprint: string;
  fingerprintKeyId: string;
}

// --- Metrics output (return of computeTaskMetrics) --------------------

export interface ExactReuseByRequest {
  requestId: string;
  requestIndex: number;
  exactReuseRatio: number | null;
  totalBytes: number;
  reusedBytes: number;
}

export interface ThreadBreakdownRow {
  threadExternalId: string | null;
  isSubagent: boolean | null;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  firstRequestIndex: number;
}

export interface RequestRow {
  requestIndex: number;
  timestamp: string;
  model: string | null;
  operationType: string | null;
  providerReportedInputTokens: number | null;
  providerReportedOutputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  latencyMs: number | null;
  threadExternalId: string | null;
  isSubagent: boolean | null;
  // Per-request StructuralBlock byte sums by context_class, and the request's
  // Exact Reuse Ratio (from exactReuseByRequest, keyed by requestIndex).
  // Presentation aids for the Requests table / exports — NOT Core Measurement.
  applicationBytes: number;
  protocolBytes: number;
  unknownBytes: number;
  exactReuseRatio: number | null;
}

export interface ObservedTokenTraffic {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  requestCount: number;
}

export interface TaskMetrics {
  taskId: string;
  basis: 'byte';
  ucv: number;
  ctv: number;
  contextAmplification: number | null;
  classificationCoverage: number | null;
  protocolShare: number | null;
  transportByClass: Record<ContextClass, number>;
  totalTransport: number;
  exactReuseByRequest: ExactReuseByRequest[];
  threadBreakdown: ThreadBreakdownRow[];
  // Per-request raw rows, request_index ascending. Presentation aid for the
  // localhost UI (Reuse Timeline thread colouring, Requests table/export) — NOT part of
  // any Core Measurement formula. See docs/ui-information-design.md §5.
  requestRows: RequestRow[];
  observedTokenTraffic: ObservedTokenTraffic;
}

// --- Debug capture (ADR-0012) ---------------------------------------

export type ChunkSelector = 'first' | 'last' | 'all' | number;

export interface DebugCaptureFilter {
  blockType: string;
  chunkSelector: ChunkSelector;
  maxBytes: number;
}

export interface DebugCaptureConfig {
  filters: DebugCaptureFilter[];
  dir: string;
  taskId: string;
}

export interface DebugCaptureMeta {
  task_id: string;
  request_id: string;
  request_index: number;
  block_seq: number;
  block_type: string;
  chunk_seq: number;
  byte_length: number;
  captured_bytes: number;
  truncated: boolean;
  created_at: string;
}

// --- Local secret / Fingerprint Key Epoch ---------------------------

export interface LocalSecret {
  epoch_id: string;
  secret_hex: string;
  created_at: string;
}
