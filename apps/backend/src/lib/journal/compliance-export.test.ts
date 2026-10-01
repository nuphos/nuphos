import { describe, expect, test } from 'bun:test'

import { buildComplianceSession, normalizeComplianceTimestamp } from './compliance-export'
import { buildAuditEvent } from './event'

import type { AuditEvent, JournalDoc } from './index'

function docs(): JournalDoc[] {
  const events: AuditEvent[] = []

  for (let seq = 1; seq <= 3; seq++) {
    events.push(
      buildAuditEvent({
        eventId: `turn_start|session-1|request-${String(seq)}`,
        seq,
        ts: `2026-07-15T01:00:0${String(seq)}.000Z`,
        type: 'turn_start',
        actor: { userId: 'user-1', teamId: 'team-1' },
        session: {
          conversationId: 'session-1',
          requestId: `request-${String(seq)}`,
          streamId: 'stream-1',
          toolCallId: null,
          modelId: 'model-1',
        },
        payload: { marker: seq },
        prevHash: events.at(-1)?.entryHash,
      }),
    )
  }

  return events.map((event) => ({
    ...event,
    sessionId: 'session-1',
    contentHot: { secretConversationText: 'must not be exported' },
  }))
}

describe('buildComplianceSession', () => {
  test('exports the complete hash-covered chain without hash-exempt content', () => {
    const source = docs()
    const result = buildComplianceSession({
      sessionId: 'session-1',
      title: 'Production investigation',
      ownerUserId: 'user-1',
      docs: source,
      contentDivergenceCount: 0,
      sealedThrough: 3,
      lastAnchorAt: '2026-07-15T02:00:00.000Z',
    })

    expect(result.events).toHaveLength(3)
    expect(result.integrity).toMatchObject({
      chainOk: true,
      eventCount: 3,
      verifiedThroughSeq: 3,
      level: 'sealed',
    })
    expect(JSON.stringify(result.events)).not.toContain('secretConversationText')
    expect(result.events[2]?.prevHash).toBe(result.events[1]?.entryHash)
  })

  test('marks a tampered chain as violated instead of presenting it as valid', () => {
    const source = docs()

    source[1] = { ...source[1]!, payload: { marker: 'forged' } }
    const result = buildComplianceSession({
      sessionId: 'session-1',
      title: 'Production investigation',
      ownerUserId: 'user-1',
      docs: source,
      contentDivergenceCount: 0,
      sealedThrough: 3,
      lastAnchorAt: '2026-07-15T02:00:00.000Z',
    })

    expect(result.integrity.chainOk).toBe(false)
    expect(result.integrity.level).toBe('violated')
    expect(
      result.integrity.violations.some((violation) => violation.code === 'payload_hash_mismatch'),
    ).toBe(true)
  })

  test('a divergent display copy downgrades otherwise valid evidence', () => {
    const result = buildComplianceSession({
      sessionId: 'session-1',
      title: 'Production investigation',
      ownerUserId: 'user-1',
      docs: docs(),
      contentDivergenceCount: 1,
      sealedThrough: 3,
      lastAnchorAt: '2026-07-15T02:00:00.000Z',
    })

    expect(result.integrity.chainOk).toBe(true)
    expect(result.integrity.contentDivergenceCount).toBe(1)
    expect(result.integrity.level).toBe('violated')
  })

  test('does not report a missing sequence number as verified', () => {
    const result = buildComplianceSession({
      sessionId: 'session-1',
      title: 'Production investigation',
      ownerUserId: 'user-1',
      docs: docs().filter((doc) => doc.seq !== 2),
      contentDivergenceCount: 0,
      sealedThrough: 3,
      lastAnchorAt: null,
    })

    expect(result.integrity.chainOk).toBe(false)
    expect(result.integrity.verifiedThroughSeq).toBe(1)
    expect(result.integrity.violations.some((violation) => violation.code === 'seq_gap')).toBe(true)
  })
})

describe('normalizeComplianceTimestamp', () => {
  test('normalizes offset timestamps before lexical journal queries', () => {
    expect(normalizeComplianceTimestamp('2026-07-17T03:00:00+02:00')).toBe(
      '2026-07-17T01:00:00.000Z',
    )
    expect(normalizeComplianceTimestamp('2026-07-17T02:00:00Z')).toBe('2026-07-17T02:00:00.000Z')
  })

  test('rejects invalid timestamps', () => {
    expect(() => normalizeComplianceTimestamp('not-a-date')).toThrow(/ISO-8601/)
  })
})
