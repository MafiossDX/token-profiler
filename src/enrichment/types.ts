// Client Enrichment layer contracts (ADR-0005/0009/0013). Kept separate from
// any one client adapter so the layers that consume enrichment output — the
// launch profile and the recorder — depend on the shape, not on
// src/enrichment/claude-code.ts.

// What a thread-identity enrichment yields for a request row: a stable
// correlation id for the Conversation Thread, plus the subagent flag when the
// adapter can tell. A concrete adapter may return a richer type (see
// ThreadIdentity in ./claude-code.ts); it stays assignable to this.
export interface ThreadMarker {
  externalSessionId: string;
  isSubagent: boolean | null;
}

// Per-function capability an enrichment adapter declares, on two independent
// axes (ADR-0009). `confidence` is only meaningful when availability ===
// 'available'; the ordering of CapabilityConfidence (most to least certain) is
// what ADR-0008's Support Tier rollup thresholds against.
export type CapabilityAvailability = 'available' | 'unimplemented' | 'blocked' | 'unsupported';
export type CapabilityConfidence =
  | 'supported_contract'
  | 'verified_best_effort'
  | 'discovered_unverified'
  | 'unknown';

export interface AdapterCapability {
  availability: CapabilityAvailability;
  confidence: CapabilityConfidence;
}
