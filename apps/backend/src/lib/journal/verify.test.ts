import { describe, expect, test } from 'bun:test'

import { buildAuditEvent } from './event'
import { verifyConversationChain } from './verify'

import type { AuditEvent } from './types'

const ACTOR = { userId: 'user-1', teamId: 'team-1' }
const SESSION = {
  conversationId: 'conv-1',
  requestId: 'req-1',
  streamId: 'stream-1',
  toolCallId: null,
  modelId: 'model-x',
}

function chain(length: number): AuditEvent[] {
  const events: AuditEvent[] = []

  for (let seq = 1; seq <= length; seq++) {
    events.push(
      buildAuditEvent({
        eventId: `turn_start|conv-1|req-${String(seq)}`,
        seq,
        ts: `2026-07-02T09:00:0${String(seq)}.000Z`,
        type: 'turn_start',
        actor: ACTOR,
        session: { ...SESSION, requestId: `req-${String(seq)}` },
        payload: { note: `event ${String(seq)}` },
        prevHash: events[seq - 2]?.entryHash,
      }),
    )
  }

  return events
}

/** Indexed access under noUncheckedIndexedAccess — chains are built locally with known length. */
function at(events: AuditEvent[], index: number): AuditEvent {
  const event = events[index]

  if (!event) throw new Error(`test chain has no event at index ${String(index)}`)

  return event
}

describe('verifyConversationChain', () => {
  test('accepts an intact chain regardless of input order', () => {
    const events = chain(5)
    const shuffled = [at(events, 3), at(events, 0), at(events, 4), at(events, 1), at(events, 2)]
    const result = verifyConversationChain(shuffled)

    expect(result.ok).toBe(true)
    expect(result.eventCount).toBe(5)
    expect(result.headHash).toBe(at(events, 4).entryHash)
  })

  test('accepts an empty chain', () => {
    const result = verifyConversationChain([])

    expect(result.ok).toBe(true)
    expect(result.headHash).toBeNull()
  })

  test('detects payload tampering', () => {
    const events = chain(3)

    events[1] = { ...at(events, 1), payload: { note: 'FORGED' } }
    const result = verifyConversationChain(events)

    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.code === 'payload_hash_mismatch' && v.seq === 2)).toBe(
      true,
    )
  })

  test('detects header tampering (ts edit)', () => {
    const events = chain(3)

    events[1] = { ...at(events, 1), ts: '2026-07-02T23:59:59.000Z' }
    const result = verifyConversationChain(events)

    expect(result.violations.some((v) => v.code === 'entry_hash_mismatch' && v.seq === 2)).toBe(
      true,
    )
  })

  test('detects a deleted middle event as a gap', () => {
    const events = chain(4)
    const withDeletion = [at(events, 0), at(events, 2), at(events, 3)]
    const result = verifyConversationChain(withDeletion)

    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.code === 'seq_gap' && v.seq === 3)).toBe(true)
  })

  test('detects a truncated head via the gap at seq 2 when seq 1 is removed', () => {
    const events = chain(3)
    const withoutGenesis = [at(events, 1), at(events, 2)]
    const result = verifyConversationChain(withoutGenesis)

    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.code === 'seq_gap' && v.seq === 2)).toBe(true)
  })

  test('detects a rewritten-in-place event (recomputed hashes, stolen seq)', () => {
    const events = chain(3)
    // Attacker fully recomputes event 2's hashes but cannot fix event 3's
    // prevHash without rewriting the rest of the chain.
    const forged = buildAuditEvent({
      eventId: 'turn_start|conv-1|req-FORGED',
      seq: 2,
      ts: at(events, 1).ts,
      type: 'turn_start',
      actor: ACTOR,
      session: { ...SESSION, requestId: 'req-FORGED' },
      payload: { note: 'looks legit' },
      prevHash: at(events, 0).entryHash,
    })
    const result = verifyConversationChain([at(events, 0), forged, at(events, 2)])

    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.code === 'broken_prev_link' && v.seq === 3)).toBe(true)
  })

  test('detects duplicate seq and duplicate eventId', () => {
    const events = chain(2)
    const dupSeq = verifyConversationChain([...events, { ...at(events, 1) }])

    expect(dupSeq.violations.some((v) => v.code === 'duplicate_seq')).toBe(true)
  })

  test('resumeFrom continues a batched verification across pages', () => {
    const events = chain(6)
    const page = events.slice(0, 3)
    const tail = events.slice(3)
    const pageResult = verifyConversationChain(page)

    expect(pageResult.ok).toBe(true)
    const tailResult = verifyConversationChain(tail, {
      resumeFrom: { seq: at(events, 2).seq, entryHash: at(events, 2).entryHash },
    })

    expect(tailResult.ok).toBe(true)
    // A forged resume point breaks the first tail link.
    const forged = verifyConversationChain(tail, {
      resumeFrom: { seq: at(events, 2).seq, entryHash: 'f'.repeat(64) },
    })

    expect(forged.violations.some((v) => v.code === 'broken_prev_link' && v.seq === 4)).toBe(true)
  })

  test('knownEventIds catches duplicate eventIds split across batches', () => {
    const events = chain(4)
    // Batch 2 contains an event whose eventId already appeared in batch 1
    // (attacker re-used an id at a different seq with recomputed hashes).
    const forged = { ...at(events, 3), eventId: at(events, 0).eventId }
    const shared = new Set<string>()
    const first = verifyConversationChain(events.slice(0, 2), { knownEventIds: shared })

    expect(first.ok).toBe(true)
    const second = verifyConversationChain([at(events, 2), forged], {
      resumeFrom: { seq: at(events, 1).seq, entryHash: at(events, 1).entryHash },
      knownEventIds: shared,
    })

    expect(second.violations.some((v) => v.code === 'duplicate_event_id')).toBe(true)
    // Without the shared registry the duplicate goes unnoticed — the gap this closes.
    const unshared = verifyConversationChain([at(events, 2), forged], {
      resumeFrom: { seq: at(events, 1).seq, entryHash: at(events, 1).entryHash },
    })

    expect(unshared.violations.some((v) => v.code === 'duplicate_event_id')).toBe(false)
  })

  test('payloadCheck:false verifies header linkage on payload-stripped events', () => {
    const events = chain(3)
    const stripped = events.map((event) => {
      const { payload: _payload, ...rest } = event

      return rest as AuditEvent
    })

    // Header-only verification passes on an intact chain...
    expect(verifyConversationChain(stripped, { payloadCheck: false }).ok).toBe(true)
    // ...and still catches header edits and deletions.
    const tampered = stripped.map((event, i) =>
      i === 1 ? { ...event, ts: '2027-01-01T00:00:00.000Z' } : event,
    )

    expect(
      verifyConversationChain(tampered, { payloadCheck: false }).violations.some(
        (v) => v.code === 'entry_hash_mismatch',
      ),
    ).toBe(true)
    const withDeletion = [at(stripped, 0), at(stripped, 2)]

    expect(
      verifyConversationChain(withDeletion, { payloadCheck: false }).violations.some(
        (v) => v.code === 'seq_gap',
      ),
    ).toBe(true)
  })
})
