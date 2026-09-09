-- Measurement Kernel v0 schema. SQLite chosen for zero-dependency local
-- storage (node:sqlite, no server, no native addon). Not a committed choice
-- for the eventual product (spec.md §25 item 10 is still open) — this is the
-- minimal thing that lets the Measurement Kernel produce reproducible values.

CREATE TABLE IF NOT EXISTS measurement_profile (
  id TEXT PRIMARY KEY,
  normalization_version TEXT NOT NULL,
  chunking_algorithm TEXT NOT NULL,
  chunking_version TEXT NOT NULL,
  min_size INTEGER NOT NULL,
  avg_size INTEGER NOT NULL,
  max_size INTEGER NOT NULL,
  fingerprint_algorithm TEXT NOT NULL,
  fingerprint_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  ended_at TEXT,
  measurement_profile_id TEXT NOT NULL,
  fingerprint_key_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  agent_role TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  request_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(task_id),
  agent_id TEXT NOT NULL REFERENCES agents(agent_id),
  request_index INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  model TEXT,
  provider TEXT NOT NULL,
  operation_type TEXT,
  provider_reported_input_tokens INTEGER,
  provider_reported_output_tokens INTEGER,
  cache_creation_input_tokens INTEGER,
  cache_read_input_tokens INTEGER,
  latency_ms INTEGER,
  -- Client Enrichment Adapter output (ADR-0005/0009/0013), NOT Core
  -- Measurement: best-effort Conversation Thread identity derived by
  -- src/enrichment/claude-code.ts. NULL whenever the adapter's marker is
  -- absent or unrecognized — never guessed, never backfilled.
  thread_external_id TEXT,
  is_subagent INTEGER
);

CREATE TABLE IF NOT EXISTS structural_blocks (
  block_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(request_id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  transport_role TEXT,
  context_class TEXT NOT NULL,
  block_fingerprint TEXT NOT NULL,
  byte_length INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS content_chunks (
  chunk_id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL REFERENCES structural_blocks(block_id),
  request_id TEXT NOT NULL REFERENCES requests(request_id),
  seq INTEGER NOT NULL,
  byte_length INTEGER NOT NULL,
  exact_fingerprint TEXT NOT NULL,
  fingerprint_key_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requests_task ON requests(task_id, request_index);
CREATE INDEX IF NOT EXISTS idx_blocks_request ON structural_blocks(request_id);
CREATE INDEX IF NOT EXISTS idx_chunks_request ON content_chunks(request_id);
CREATE INDEX IF NOT EXISTS idx_chunks_fingerprint ON content_chunks(fingerprint_key_id, exact_fingerprint);
