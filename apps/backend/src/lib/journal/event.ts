import { computeEntryHash, computePayloadHash } from './hashing'
import { GENESIS_PREV_HASH, JOURNAL_SCHEMA_VERSION } from './types'

import type { AuditActor, AuditEvent, AuditEventType, AuditSession, JsonValue } from './types'

export class JournalEventIdError extends Error {
  constructor(type: AuditEventType, missing: string) {
    super(`cannot derive eventId for "${type}": missing ${missing}`)
    this.name = 'JournalEventIdError'
  }
}

export type EventIdParts = {
  conversationId: string
  requestId?: string | null
  toolCallId?: string | null
  messageId?: string | null
  /** Disambiguator for events with no natural id (e.g. retention batches). */
  qualifier?: string | null
}

/**
 * Deterministic idempotency key (v2.1 #1). Deliberately NEVER includes a
 * retry/attempt counter: an ambiguous write (insert acknowledged but response
 * lost) must dedupe on retry, not append a duplicate semantic event.
 * All id components are UUID/ULID-shaped, so a plain '|' join is unambiguous.
 */
export function deriveEventId(type: AuditEventType, parts: EventIdParts): string {
  const need = (value: string | null | undefined, name: string): string => {
    if (!value) throw new JournalEventIdError(type, name)

    return value
  }

  switch (type) {
    case 'tool_call_intent':
    case 'tool_call_result':
    case 'user_approval':
      return [
        type,
        parts.conversationId,
        need(parts.requestId, 'requestId'),
        need(parts.toolCallId, 'toolCallId'),
      ].join('|')
    case 'auth_decision':
      // Distinct per (toolCall, decision) so a require-auth-then-allow
      // sequence for the same command lands as two chain events.
      return [
        type,
        parts.conversationId,
        need(parts.requestId, 'requestId'),
        need(parts.toolCallId, 'toolCallId'),
        need(parts.qualifier, 'qualifier'),
      ].join('|')
    case 'client_tool_result':
      return [
        type,
        parts.conversationId,
        need(parts.messageId, 'messageId'),
        need(parts.toolCallId, 'toolCallId'),
      ].join('|')
    case 'user_message':
    case 'assistant_message':
      return [type, parts.conversationId, need(parts.messageId, 'messageId')].join('|')
    case 'turn_start':
    case 'turn_end':
    case 'credential_grant':
      return [type, parts.conversationId, need(parts.requestId, 'requestId')].join('|')
    case 'conversation_retention_tombstone':
    case 'journal_retention_expired':
      return [type, parts.conversationId, need(parts.qualifier, 'qualifier')].join('|')
  }
}

export type BuildEventInput = {
  eventId: string
  seq: number
  ts: string
  type: AuditEventType
  actor: AuditActor
  session: AuditSession
  payload: JsonValue
  /** entryHash of the previous event; omit for seq 1. */
  prevHash?: string
}

export function buildAuditEvent(input: BuildEventInput): AuditEvent {
  const prevHash = input.prevHash ?? GENESIS_PREV_HASH
  const payloadHash = computePayloadHash(input.payload)
  const header = {
    v: JOURNAL_SCHEMA_VERSION,
    eventId: input.eventId,
    seq: input.seq,
    ts: input.ts,
    type: input.type,
    actor: input.actor,
    session: input.session,
    payload: input.payload,
    payloadHash,
    prevHash,
  }

  return { ...header, entryHash: computeEntryHash(header) }
}
