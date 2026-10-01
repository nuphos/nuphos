// Tamper-evident agent audit journal — core types.
//
// One hash chain per conversation (sessionId): every event's entryHash covers
// the previous event's entryHash, so any in-place edit, deletion, or reorder
// inside a conversation breaks recomputation. Integrity does NOT rely on
// MongoDB being trustworthy — the hot collection is only the queryable copy;
// sealed S3 segments and external anchors extend the trust boundary.

export const JOURNAL_SCHEMA_VERSION = 1 as const

/** prevHash of the first event (seq 1) in every conversation chain. */
export const GENESIS_PREV_HASH = '0'.repeat(64)

export type AuditEventType =
  | 'turn_start'
  | 'turn_end'
  | 'user_message'
  | 'assistant_message'
  | 'tool_call_intent'
  | 'tool_call_result'
  | 'auth_decision'
  | 'client_tool_result'
  | 'credential_grant'
  | 'user_approval'
  | 'conversation_retention_tombstone'
  | 'journal_retention_expired'

export type AuditActor = {
  userId: string
  teamId: string | null
}

export type AuditSession = {
  conversationId: string
  requestId: string | null
  streamId: string | null
  toolCallId: string | null
  modelId: string | null
}

/** JSON value accepted in payloads. undefined / NaN / Infinity are rejected at canonicalization. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type AuditEvent = {
  v: typeof JOURNAL_SCHEMA_VERSION
  /**
   * Deterministic idempotency key, unique per semantic event. Never includes
   * a retry attempt counter — an ambiguous write retried with the same
   * eventId must dedupe to the already-persisted event.
   */
  eventId: string
  /** Per-conversation monotonic sequence, starting at 1. */
  seq: number
  /** ISO-8601 UTC. Display/ordering hint only — chain integrity never depends on ts. */
  ts: string
  type: AuditEventType
  actor: AuditActor
  session: AuditSession
  payload: JsonValue
  /** sha256 hex of canonicalize(payload). */
  payloadHash: string
  /** entryHash of the event at seq-1, or GENESIS_PREV_HASH at seq 1. */
  prevHash: string
  /** sha256 hex of canonicalize(event header) — see computeEntryHash. */
  entryHash: string
}

/** Fields covered by entryHash (everything except entryHash itself). */
export type AuditEventHeader = Omit<AuditEvent, 'entryHash'>

/**
 * Payload fields carrying an HMAC of a redacted-away original always name the
 * key that produced it, so records stay verifiable across key rotation (v2.2).
 */
export type HmacRef = {
  hmac: string
  hmacKeyId: string
  hmacKeyVersion: string
}
