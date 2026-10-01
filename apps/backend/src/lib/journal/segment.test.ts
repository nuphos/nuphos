import { describe, expect, test } from 'bun:test'

import { buildAuditEvent } from './event'
import {
  GENESIS_SEGMENT_HASH,
  buildInventoryManifest,
  buildSegmentBody,
  buildSegmentManifest,
  segmentIdForCounter,
  verifySegment,
} from './segment'

import type { AuditEvent } from './types'

const ACTOR = { userId: 'user-1', teamId: 'team-1' }

function chainFor(
  sessionId: string,
  fromSeq: number,
  count: number,
  prevHash?: string,
): AuditEvent[] {
  const events: AuditEvent[] = []

  for (let i = 0; i < count; i++) {
    const seq = fromSeq + i

    events.push(
      buildAuditEvent({
        eventId: `turn_start|${sessionId}|req-${String(seq)}`,
        seq,
        ts: '2026-07-02T09:00:00.000Z',
        type: 'turn_start',
        actor: ACTOR,
        session: {
          conversationId: sessionId,
          requestId: `req-${String(seq)}`,
          streamId: 'stream-1',
          toolCallId: null,
          modelId: 'model-x',
        },
        payload: { note: seq },
        prevHash: events.at(-1)?.entryHash ?? prevHash,
      }),
    )
  }

  return events
}

function sealedSegment(events: AuditEvent[], prev = GENESIS_SEGMENT_HASH) {
  const { body, ordered, coverage } = buildSegmentBody(events)
  const signed = buildSegmentManifest({
    kind: 'events',
    segmentId: segmentIdForCounter(1),
    prevSegmentHash: prev,
    sealedAt: '2026-07-02T10:00:00.000Z',
    body,
    ordered,
    coverage,
  })

  return { body, signed }
}

describe('buildSegmentBody', () => {
  test('orders by (session, seq), computes contiguous coverage, deterministic bytes', () => {
    const a = chainFor('conv-a', 1, 2)
    const b = chainFor('conv-b', 3, 2)
    const first = buildSegmentBody([...b, ...a])
    const second = buildSegmentBody([a[1]!, b[0]!, a[0]!, b[1]!])

    expect(first.body).toBe(second.body)
    expect(first.coverage).toEqual([
      { sessionId: 'conv-a', fromSeq: 1, toSeq: 2 },
      { sessionId: 'conv-b', fromSeq: 3, toSeq: 4 },
    ])
  })

  test('rejects non-contiguous runs (watermark violation)', () => {
    const events = chainFor('conv-a', 1, 3)

    expect(() => buildSegmentBody([events[0]!, events[2]!])).toThrow(/contiguous/)
  })
})

describe('verifySegment', () => {
  test('accepts an intact sealed segment', () => {
    const { body, signed } = sealedSegment(chainFor('conv-a', 1, 3))

    expect(verifySegment({ signed, body, expectedPrevSegmentHash: GENESIS_SEGMENT_HASH })).toEqual(
      [],
    )
  })

  test('detects body tampering', () => {
    const { body, signed } = sealedSegment(chainFor('conv-a', 1, 3))
    const tampered = body.replace('"note":1', '"note":999')
    const violations = verifySegment({
      signed,
      body: tampered,
      expectedPrevSegmentHash: GENESIS_SEGMENT_HASH,
    })

    expect(violations.some((v) => v.code === 'body_hash_mismatch')).toBe(true)
  })

  test('detects manifest tampering and broken segment links', () => {
    const { body, signed } = sealedSegment(chainFor('conv-a', 1, 2))
    const forgedManifest = {
      ...signed,
      manifest: { ...signed.manifest, eventCount: 999 },
    }

    expect(
      verifySegment({
        signed: forgedManifest,
        body,
        expectedPrevSegmentHash: GENESIS_SEGMENT_HASH,
      }).some((v) => v.code === 'manifest_hash_mismatch'),
    ).toBe(true)
    expect(
      verifySegment({ signed, body, expectedPrevSegmentHash: 'f'.repeat(64) }).some(
        (v) => v.code === 'broken_segment_link',
      ),
    ).toBe(true)
  })
})

describe('inventory segments', () => {
  test('heads snapshot builds a verifiable inventory manifest', () => {
    const { body, signed } = buildInventoryManifest({
      segmentId: segmentIdForCounter(7),
      prevSegmentHash: 'a'.repeat(64),
      sealedAt: '2026-07-03T02:30:00.000Z',
      heads: [
        { sessionId: 'conv-b', maxSeq: 4, headHash: 'b'.repeat(64) },
        { sessionId: 'conv-a', maxSeq: 9, headHash: 'c'.repeat(64) },
      ],
    })

    expect(signed.manifest.kind).toBe('inventory')
    expect(verifySegment({ signed, body, expectedPrevSegmentHash: 'a'.repeat(64) })).toEqual([])
    // Sorted by sessionId regardless of input order.
    expect(body.indexOf('conv-a')).toBeLessThan(body.indexOf('conv-b'))
  })
})
