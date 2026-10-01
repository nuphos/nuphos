import { computeEntryHash, computePayloadHash, digestEquals } from './hashing'
import { GENESIS_PREV_HASH, JOURNAL_SCHEMA_VERSION } from './types'

import type { AuditEvent } from './types'

export type ChainViolation = {
  seq: number
  code:
    | 'bad_version'
    | 'seq_gap'
    | 'duplicate_seq'
    | 'duplicate_event_id'
    | 'broken_prev_link'
    | 'payload_hash_mismatch'
    | 'entry_hash_mismatch'
  message: string
}

export type ChainVerification = {
  ok: boolean
  eventCount: number
  headHash: string | null
  violations: ChainViolation[]
}

export type ChainVerifyOptions = {
  /**
   * Continue an earlier verification: expect the next event at seq+1 chained
   * to entryHash. Lets callers verify huge chains in batches without holding
   * every event in memory.
   */
  resumeFrom?: { seq: number; entryHash: string }
  /**
   * Skip recomputing payloadHash from event.payload — used for header-only
   * projections (payload omitted for memory). entryHash still covers the
   * RECORDED payloadHash, so linkage/order/edit detection stays intact; only
   * "payload no longer matches its recorded hash" is not checked.
   */
  payloadCheck?: boolean
  /**
   * Shared eventId registry for batched verification: pass the SAME set to
   * every batch so a duplicate eventId split across batches is still caught.
   * The verifier adds every id it sees. Defaults to a per-call set.
   */
  knownEventIds?: Set<string>
}

/**
 * Pure recomputation of one conversation chain. Events may arrive in any
 * order; extra storage fields are ignored. Any in-place edit, deletion,
 * insertion or reorder surfaces as at least one violation.
 */
export function verifyConversationChain(
  events: AuditEvent[],
  options?: ChainVerifyOptions,
): ChainVerification {
  const violations: ChainViolation[] = []
  const sorted = [...events].sort((a, b) => a.seq - b.seq)
  const seenEventIds = options?.knownEventIds ?? new Set<string>()
  const payloadCheck = options?.payloadCheck ?? true
  let prevHash = options?.resumeFrom?.entryHash ?? GENESIS_PREV_HASH
  let expectedSeq = (options?.resumeFrom?.seq ?? 0) + 1

  for (const event of sorted) {
    if (event.v !== JOURNAL_SCHEMA_VERSION) {
      violations.push({
        seq: event.seq,
        code: 'bad_version',
        message: `unknown schema version ${String(event.v)}`,
      })
    }

    if (event.seq < expectedSeq) {
      violations.push({
        seq: event.seq,
        code: 'duplicate_seq',
        message: `sequence ${String(event.seq)} appears more than once`,
      })
      continue
    }
    if (event.seq > expectedSeq) {
      violations.push({
        seq: event.seq,
        code: 'seq_gap',
        message: `expected seq ${String(expectedSeq)}, found ${String(event.seq)} — ${String(event.seq - expectedSeq)} event(s) missing`,
      })
      // Resynchronize so one gap does not cascade into noise for every
      // later event; the chain is already conclusively broken here.
      prevHash = event.prevHash
    }

    if (seenEventIds.has(event.eventId)) {
      violations.push({
        seq: event.seq,
        code: 'duplicate_event_id',
        message: `eventId ${event.eventId} appears more than once`,
      })
    }
    seenEventIds.add(event.eventId)

    if (event.prevHash !== prevHash) {
      violations.push({
        seq: event.seq,
        code: 'broken_prev_link',
        message: `prevHash does not match entryHash of seq ${String(event.seq - 1)}`,
      })
    }

    if (payloadCheck) {
      const payloadHash = computePayloadHash(event.payload)

      if (!digestEquals(payloadHash, event.payloadHash)) {
        violations.push({
          seq: event.seq,
          code: 'payload_hash_mismatch',
          message: 'payload does not hash to recorded payloadHash — payload was modified',
        })
      }
    }

    const { entryHash: recordedEntryHash, ...header } = event
    const entryHash = computeEntryHash(header)

    if (!digestEquals(entryHash, recordedEntryHash)) {
      violations.push({
        seq: event.seq,
        code: 'entry_hash_mismatch',
        message: 'header does not hash to recorded entryHash — event was modified',
      })
    }

    prevHash = recordedEntryHash
    expectedSeq = event.seq + 1
  }

  return {
    ok: violations.length === 0,
    eventCount: sorted.length,
    headHash: sorted.at(-1)?.entryHash ?? null,
    violations,
  }
}
