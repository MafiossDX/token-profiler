import type { AdapterCapability, ThreadMarker } from './types.ts';

// Claude Code Enrichment Adapter (ADR-0005/0009/0013). This layer sits ABOVE
// Core Measurement and the Provider Protocol, and is explicitly best-effort:
// it reads a non-public, version-dependent pseudo-header that Claude Code
// embeds at the start of the system prompt text —
//
//   x-anthropic-billing-header: cc_version=X.Y.Z.<suffix>; cc_entrypoint=...; [cc_is_subagent=true;]
//
// — and derives a Conversation Thread's `external_session_id` from
// `<suffix>`. Evidence (internal dogfooding spike): within one Task, all
// requests of the main agent shared one suffix and the background/auxiliary
// agent had a different one, stable across every request in that agent — i.e.
// the suffix is stable per Agent, not per request. Confirmed for one Task
// only; not re-verified across multiple Tasks or Claude Code versions.
//
// Per ADR-0005's Core/Adapter boundary: if the marker's format changes or
// disappears, this MUST fail silently (return null) rather than throw or
// guess — Core Measurement never depends on this succeeding. Input is the
// already-extracted system-prompt text (a plain string), so this adapter has
// no dependency on the provider protocol's request shape.

export const capabilities: Record<string, AdapterCapability> = {
  thread_identity: { availability: 'available', confidence: 'verified_best_effort' },
  // cc_is_subagent was documented in an earlier spike (ADR-0005) but did not
  // appear in the subagent capture in the dogfooding spike above — presence
  // looks call-site dependent, so this stays one notch below thread_identity
  // until re-verified.
  subagent_identity: { availability: 'available', confidence: 'discovered_unverified' },
};

export interface ThreadIdentity extends ThreadMarker {
  // Claude Code-specific provenance, not consumed above the enrichment layer.
  ccVersion: string;
  entrypoint: string;
}

const BILLING_HEADER_RE =
  /^x-anthropic-billing-header:\s*cc_version=(\d+\.\d+\.\d+)\.([A-Za-z0-9]+);\s*cc_entrypoint=([\w-]+);(?:\s*cc_is_subagent=(true|false);)?/;

/**
 * Derives Conversation Thread identity from the raw system-prompt text of a
 * request. Returns null when the marker is absent or doesn't match — callers
 * must treat that as "no thread info", never as an error.
 */
export function identifyThread(systemText: string): ThreadIdentity | null {
  if (!systemText) return null;

  const m = BILLING_HEADER_RE.exec(systemText);
  if (!m) return null;

  const [, ccVersion, suffix, entrypoint, isSubagentRaw] = m;
  return {
    externalSessionId: suffix!,
    ccVersion: ccVersion!,
    entrypoint: entrypoint!,
    isSubagent: isSubagentRaw === undefined ? null : isSubagentRaw === 'true',
  };
}
