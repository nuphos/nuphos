import { buildAuditEvent } from './event'
import { toStorableJson } from './normalize'

import type { AuditActor, AuditEvent, AuditEventType, AuditSession, JsonValue } from './types'
import type { Collection } from 'mongodb'

export const JOURNAL_COLLECTION = 'agent_journal'

/**
 * Stored shape: the AuditEvent plus storage-side extras that are never covered
 * by entryHash — the verifier recomputes hashes from the canonical event
 * fields only.
 *
 * contentHot: display copy of the content whose hash lives in
 * payload.contentHash. Deliberately OUTSIDE the chain: it is deletable
 * (user-deletion/retention) and the sealer never ships it to WORM — sealed
 * segments carry hashes only. payload.contentHash is what makes it trustworthy:
 * recompute-and-compare at read time.
 */
export type JournalDoc = AuditEvent & { sessionId: string; contentHot?: JsonValue }

export async function ensureJournalIndexes(collection: Collection<JournalDoc>): Promise<void> {
  // Chain position: at most one event per (conversation, seq). A losing
  // concurrent appender hits this and retries against the new tail.
  await collection.createIndex(
    { sessionId: 1, seq: 1 },
    { unique: true, name: 'session_seq_unique' },
  )
  // Idempotency: at most one event per semantic eventId. An ambiguous-write
  // retry hits this and resolves to the already-persisted event.
  await collection.createIndex({ eventId: 1 }, { unique: true, name: 'event_id_unique' })
  // Cross-conversation audit queries: team- and user-scoped timelines, newest
  // first. ts is display metadata (integrity never depends on it), which is
  // exactly what a browse index should sort by.
  await collection.createIndex({ 'actor.teamId': 1, ts: -1 }, { name: 'team_ts' })
  await collection.createIndex({ 'actor.userId': 1, ts: -1 }, { name: 'user_ts' })
}

export class JournalAppendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JournalAppendError'
  }
}

export type JournalAppendInput = {
  eventId: string
  type: AuditEventType
  actor: AuditActor
  session: AuditSession
  payload: JsonValue
  /** Hash-exempt display copy (see JournalDoc.contentHot). */
  contentHot?: JsonValue
}

export type JournalAppendResult = {
  event: AuditEvent
  /** true when the eventId already existed and the stored event was returned. */
  deduped: boolean
}

type MongoDuplicateKeyError = {
  code?: number
  keyPattern?: Record<string, unknown>
  message?: string
}

function isDuplicateKey(error: unknown): error is MongoDuplicateKeyError {
  return (
    typeof error === 'object' && error !== null && (error as MongoDuplicateKeyError).code === 11000
  )
}

function isEventIdConflict(error: MongoDuplicateKeyError): boolean {
  if (error.keyPattern) return 'eventId' in error.keyPattern

  return typeof error.message === 'string' && error.message.includes('event_id_unique')
}

const MAX_APPEND_ATTEMPTS = 8

/**
 * Optimistic append: the insert itself advances the chain. There is no
 * seq pre-allocation and no transaction — a crash before insert leaves nothing
 * behind (no gap), a lost race leaves a duplicate-key error behind (retry
 * against the new tail). The per-conversation head is derivable from the
 * collection and never stored authoritatively.
 *
 * Callers enforcing fail-closed semantics (mutating tools) must await this
 * and treat any thrown error as "do not execute".
 */
export class JournalWriter {
  constructor(
    private readonly collection: Collection<JournalDoc>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async append(input: JournalAppendInput): Promise<JournalAppendResult> {
    // Normalize BEFORE hashing: the chain/content hashes must cover the exact
    // value the store round-trips, or read-time verification reports phantom
    // tampering.
    const payload = toStorableJson(input.payload)
    const contentHot = input.contentHot !== undefined ? toStorableJson(input.contentHot) : undefined

    for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt++) {
      const sessionId = input.session.conversationId
      const tail = await this.collection.findOne(
        { sessionId },
        { sort: { seq: -1 }, projection: { seq: 1, entryHash: 1 } },
      )

      const event = buildAuditEvent({
        eventId: input.eventId,
        seq: (tail?.seq ?? 0) + 1,
        ts: this.now().toISOString(),
        type: input.type,
        actor: input.actor,
        session: input.session,
        payload,
        prevHash: tail?.entryHash,
      })

      try {
        await this.collection.insertOne({
          ...event,
          sessionId,
          ...(contentHot !== undefined ? { contentHot } : {}),
        } as JournalDoc)

        return { event, deduped: false }
      } catch (error) {
        if (!isDuplicateKey(error)) throw error
        if (isEventIdConflict(error)) {
          const existing = await this.collection.findOne({ eventId: input.eventId })

          if (existing) {
            // Dedupe is only safe when the stored event IS this event. If a
            // caller bug ever derives the same eventId for different content,
            // silently returning the stored row would discard a distinct
            // audit event — fail loudly instead (audit completeness beats
            // availability here).
            if (
              existing.type !== event.type ||
              existing.payloadHash !== event.payloadHash ||
              existing.session.conversationId !== event.session.conversationId
            ) {
              throw new JournalAppendError(
                `eventId ${input.eventId} already exists with DIFFERENT content — ` +
                  'refusing to dedupe a non-identical event (id derivation bug?)',
              )
            }
            const { sessionId: _sessionId, contentHot: _contentHot, ...rest } = existing

            delete (rest as { _id?: unknown })._id

            return { event: rest as AuditEvent, deduped: true }
          }
          // Existing row vanished between conflict and read — fall through to retry.
        }
        // (sessionId, seq) conflict: another appender won the tail; retry.
      }
    }
    throw new JournalAppendError(
      `journal append for ${input.eventId} lost ${String(MAX_APPEND_ATTEMPTS)} consecutive races`,
    )
  }
}
