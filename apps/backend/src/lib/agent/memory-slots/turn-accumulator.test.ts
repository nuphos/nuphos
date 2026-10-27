// T-Phase2: the per-turn accumulator that replaces agent.ts's loose observer
// maps (fetchedMemoryIds / fetchedMemoryLabels / supersededMemoryIds) and the
// inline memory.searched sink. Contract under test: exact telemetry payload
// parity with today's agent.ts sink, supersede keyed by supersededId (never
// id), frame emission through the runtime renderer, and a view() that carries
// everything the finish consumers need.

import { describe, expect, test } from 'bun:test'

import { renderMemorySavedFrame } from './save-frame'
import { createTurnMemoryAccumulator } from './turn-accumulator'


type RecordedEvent = {
  conversationId: string
  event: string
  userId?: string
  data?: Record<string, unknown>
}

const make = () => {
  const frames: Record<string, unknown>[] = []
  const events: RecordedEvent[] = []
  const acc = createTurnMemoryAccumulator({
    providerId: 'native',
    sessionId: 'sess-1',
    userId: 'u1',
    teamId: 't1',
    requestId: 'req-1',
    emitFrame: (frame) => frames.push(frame),
    recordEvent: (fields) => events.push(fields),
  })

  return { acc, frames, events }
}

describe('searched sink — memory.searched telemetry parity', () => {
  test('payload matches the agent.ts shape: redacted query, CJK flag, per-kind counts', () => {
    const { acc, events } = make()

    acc.observer.searched({
      query: 'oom exit 137',
      hitCount: 3,
      hitsByKind: { record: 2, playbook: 1 },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      conversationId: 'sess-1',
      event: 'memory.searched',
      userId: 'u1',
      data: {
        query: 'oom exit 137',
        queryHasCjk: false,
        // Persisted analytics keys keep their legacy shape: hitCount is the
        // flat-record count, geneHitCount the playbook count.
        hitCount: 2,
        geneHitCount: 1,
      },
    })
  })

  test('CJK query flags true and long queries truncate to 200 chars', () => {
    const { acc, events } = make()

    acc.observer.searched({ query: `部署失敗${'x'.repeat(300)}`, hitCount: 0 })
    const data = events[0]!.data!

    expect(data.queryHasCjk).toBe(true)
    expect((data.query as string).length).toBeLessThanOrEqual(200)
    // Vendor without a per-kind breakdown: total stands in for the record
    // count, playbook count is honestly zero.
    expect(data.hitCount).toBe(0)
    expect(data.geneHitCount).toBe(0)
  })

  test('secret-bearing query is redacted before recording', () => {
    const { acc, events } = make()

    acc.observer.searched({
      query: 'why does AKIAIOSFODNN7EXAMPLE fail auth',
      hitCount: 1,
      hitsByKind: { record: 1, playbook: 0 },
    })
    expect(events[0]!.data!.query as string).not.toContain('AKIAIOSFODNN7EXAMPLE')
  })
})

describe('saved sink', () => {
  test('created → frame emitted via the runtime renderer with the memory-saved eventId', () => {
    const { acc, frames } = make()

    acc.observer.saved({
      id: 'm1',
      scope: 'personal',
      kind: 'record',
      title: 'Release tagging',
      action: 'created',
      type: 'fact',
      text: 'Always tag releases before deploy',
      categories: ['deploy'],
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z',
    })
    expect(frames).toHaveLength(1)
    expect(frames[0]).toEqual(
      renderMemorySavedFrame({
        eventId: 'sess-1:memory-saved:m1',
        sessionId: 'sess-1',
        event: {
          id: 'm1',
          scope: 'personal',
          kind: 'record',
          title: 'Release tagging',
          action: 'created',
          type: 'fact',
          text: 'Always tag releases before deploy',
          categories: ['deploy'],
          createdAt: '2026-07-25T00:00:00.000Z',
          updatedAt: '2026-07-25T00:00:00.000Z',
        },
      }),
    )
  })

  test('superseded → no frame; accumulated by supersededId (never id) with scope', () => {
    const { acc, frames } = make()

    // Standalone lifecycle event: id === supersededId per the SPI contract.
    acc.observer.saved({
      id: 'm-old',
      scope: 'personal',
      title: '',
      action: 'superseded',
      supersededId: 'm-old',
    })
    acc.observer.saved({
      id: 'g-new',
      scope: 'team',
      title: 'replacement',
      action: 'superseded',
      supersededId: 'g-old',
    })
    expect(frames).toHaveLength(0)
    const view = acc.view()

    // The second event's successor-known shape must still key off
    // supersededId — keying off id would mark the NEW memory as corrected.
    expect(view.supersededPersonalIds).toEqual(['m-old'])
    expect(view.supersededTeamIds).toEqual(['g-old'])
  })

  test('superseded without a supersededId accumulates nothing (nothing was corrected)', () => {
    const { acc } = make()

    acc.observer.saved({ id: 'm1', title: '', action: 'superseded' })
    expect(acc.view().supersededPersonalIds).toEqual([])
    expect(acc.view().supersededTeamIds).toEqual([])
  })

  test('vendor-autonomous deleted → no frame (nothing was created)', () => {
    const { acc, frames } = make()

    acc.observer.saved({ id: 'm1', title: 'gone', action: 'deleted' })
    expect(frames).toHaveLength(0)
  })

  test('updated → no frame; feeds the correction map like superseded (lifecycle-fact channel)', () => {
    const { acc, frames } = make()

    acc.observer.saved({
      id: 'm-new',
      scope: 'team',
      title: 'revised',
      action: 'updated',
      supersededId: 'm-prev',
    })
    acc.observer.saved({ id: 'm2', title: 'no correction', action: 'updated' })
    expect(frames).toHaveLength(0)
    expect(acc.view().supersededTeamIds).toEqual(['m-prev'])
    expect(acc.view().supersededPersonalIds).toEqual([])
  })

  test('drafted → no frame (pending-review card is later-phase UX; a saved chip would lie)', () => {
    const { acc, frames } = make()

    acc.observer.saved({ id: 'd1', title: 'proposal', action: 'drafted' })
    expect(frames).toHaveLength(0)
  })

  test('throwing emitFrame never propagates (observer arrives pre-wrapped fail-open)', () => {
    const events: RecordedEvent[] = []
    const acc = createTurnMemoryAccumulator({
      providerId: 'native',
      sessionId: 'sess-1',
      userId: 'u1',
      teamId: null,
      requestId: 'req-1',
      emitFrame: () => {
        throw new Error('stream closed')
      },
      recordEvent: (fields) => events.push(fields),
    })

    expect(() => acc.observer.saved({ id: 'm1', title: 't', action: 'created' })).not.toThrow()
  })
})

describe('fetched sink + view()', () => {
  test('fetched ids split by scope; labels captured for the judge', () => {
    const { acc } = make()

    acc.observer.fetched({ id: 'g1', scope: 'team', kind: 'playbook', label: 'OOM triage' })
    acc.observer.fetched({
      id: 'r1',
      scope: 'personal',
      kind: 'record',
      label: 'kubectl preference',
    })
    acc.observer.fetched({ id: 'r2', scope: 'personal', kind: 'record' }) // no label
    const view = acc.view()

    expect(view.fetchedIds).toEqual(['g1', 'r1', 'r2'])
    expect(view.fetchedTeamIds).toEqual(['g1'])
    expect(view.fetchedPersonalIds).toEqual(['r1', 'r2'])
    expect(view.fetchedLabels.get('g1')).toBe('OOM triage')
    expect(view.fetchedLabels.has('r2')).toBe(false)
  })

  test('re-fetching the same id keeps one entry (Map semantics, matching agent.ts)', () => {
    const { acc } = make()

    acc.observer.fetched({ id: 'g1', scope: 'team', label: 'first' })
    acc.observer.fetched({ id: 'g1', scope: 'team', label: 'second' })
    const view = acc.view()

    expect(view.fetchedIds).toEqual(['g1'])
    expect(view.fetchedLabels.get('g1')).toBe('second')
  })

  test('view carries provider/turn identity for MemoryRef stamping downstream', () => {
    const { acc } = make()
    const view = acc.view()

    expect(view.providerId).toBe('native')
    expect(view.requestId).toBe('req-1')
  })
})
