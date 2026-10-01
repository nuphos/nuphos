// Wire-compat lock for the runtime-owned memory-ingest frame builder. The
// legacy builder (memory-native's buildMemorySavedFrame) retired with the Phase
// 2 PR 3 call-site swap, so the lock is now a RECORDED golden: the three
// expected frames below started as captures from the old builder. Additive
// fields are pinned here as the desktop contract evolves.
//
// Desktop chip contract (AgentPanel.tsx): renders only when status==='ok' &&
// jobStatus==='succeeded' && memoriesCreated+memoriesUpdated > 0, and every
// memories[] entry must satisfy isAgentMemoryIngestEventItem.

import { describe, expect, test } from 'bun:test'

import { renderMemorySavedFrame } from './save-frame'

import type { MemorySavedEvent } from './types'

const SESSION = 'conv-parity-1'

/** Mirror of the desktop's isAgentMemoryIngestEventItem gate
 * (AgentPanel.tsx) — an entry failing this predicate renders no chip. */
function satisfiesIngestEventItem(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>

  return (
    typeof item.id === 'string' &&
    (item.type === 'fact' || item.type === 'artifact' || item.type === 'episode') &&
    (item.title === undefined || typeof item.title === 'string') &&
    typeof item.text === 'string' &&
    Array.isArray(item.categories) &&
    item.categories.every((c) => typeof c === 'string') &&
    Array.isArray(item.scopes) &&
    item.scopes.every((s) => s === 'personal' || s === 'team') &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string'
  )
}

/** The explicit chip-contract assertions, applied to every golden frame. */
function expectChipContract(frame: Record<string, unknown>): void {
  expect(frame.type).toBe('memory-ingest')
  expect(frame.status).toBe('ok')
  expect(frame.jobStatus).toBe('succeeded')
  expect(frame.memoriesCreated).toBe(1)
  expect(frame.memoriesUpdated).toBe(0)
  const memories = frame.memories as unknown[]

  expect(Array.isArray(memories)).toBe(true)
  expect(satisfiesIngestEventItem(memories[0])).toBe(true)
}

describe('renderMemorySavedFrame — recorded golden parity with the retired buildMemorySavedFrame', () => {
  test('personal save (save_memory personal path)', () => {
    const memoryId = '66a0c96211474dcb6a6c51c6'
    const nowIso = '2026-07-25T10:00:00.000Z'
    const eventId = `${SESSION}:memory-saved:${memoryId}`
    const event: MemorySavedEvent = {
      id: memoryId,
      scope: 'personal',
      kind: 'record',
      title: 'Always tag releases before deploy',
      action: 'created',
      type: 'fact',
      text: 'Always tag releases before deploy',
      categories: ['deploy'],
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    const frame = renderMemorySavedFrame({ eventId, sessionId: SESSION, event })

    // Recorded golden — captured from buildMemorySavedFrame before deletion.
    expect(frame).toEqual({
      type: 'memory-ingest',
      eventId,
      sessionId: SESSION,
      status: 'ok',
      jobStatus: 'succeeded',
      memoriesCreated: 1,
      memoriesUpdated: 0,
      memories: [
        {
          id: memoryId,
          type: 'fact',
          title: 'Always tag releases before deploy',
          text: 'Always tag releases before deploy',
          categories: ['deploy'],
          scopes: ['personal'],
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ],
    })
    expectChipContract(frame)
  })

  test('team playbook save — republished path where createdAt ≠ updatedAt', () => {
    // Golden inputs recorded from playbookToItem() on the republished-playbook
    // fixture (revision 2, created 07-01, updated 07-25) — the rendered text
    // is the playbook body exactly as the old builder framed it.
    const memoryId = '6a6c51c66ab0c96211474dcb'
    const playbookText =
      'Registry 502 triage\n\nSignals: 502, registry\nInvestigation path:\n1. check ingress — 502 from upstream?\nTraps:\n- restarting the app first\nDo not use when:\n- registry is external'
    const eventId = `${SESSION}:memory-saved:${memoryId}`
    const event: MemorySavedEvent = {
      id: memoryId,
      scope: 'team',
      kind: 'playbook',
      title: 'Registry 502 triage',
      action: 'created',
      type: 'artifact',
      text: playbookText,
      categories: [],
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-25T10:00:00.000Z',
    }
    const frame = renderMemorySavedFrame({ eventId, sessionId: SESSION, event })

    expect(frame).toEqual({
      type: 'memory-ingest',
      eventId,
      sessionId: SESSION,
      status: 'ok',
      jobStatus: 'succeeded',
      memoriesCreated: 1,
      memoriesUpdated: 0,
      memories: [
        {
          id: memoryId,
          type: 'artifact',
          title: 'Registry 502 triage',
          text: playbookText,
          categories: [],
          scopes: ['team'],
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-25T10:00:00.000Z',
        },
      ],
    })
    expectChipContract(frame)
    // The lock must bite on real timestamps, not two copies of "now".
    const item = (frame.memories as Record<string, unknown>[])[0]!

    expect(item.createdAt).not.toBe(item.updatedAt)
  })

  test('auto-ingest save (turn-ingest dispatcher path)', () => {
    const memoryId = '5f3c51c66ab0c96211474dcc'
    const nowIso = '2026-07-25T12:34:56.000Z'
    const eventId = `${SESSION}:auto-ingest:${memoryId}`
    const event: MemorySavedEvent = {
      id: memoryId,
      scope: 'team',
      kind: 'record',
      title: 'Canary first',
      action: 'created',
      type: 'fact',
      text: 'Deploys go through the canary pipeline first',
      categories: ['deploy', 'auto-learned'],
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    const frame = renderMemorySavedFrame({ eventId, sessionId: SESSION, event })

    expect(frame).toEqual({
      type: 'memory-ingest',
      eventId,
      sessionId: SESSION,
      status: 'ok',
      jobStatus: 'succeeded',
      memoriesCreated: 1,
      memoriesUpdated: 0,
      memories: [
        {
          id: memoryId,
          type: 'fact',
          title: 'Canary first',
          text: 'Deploys go through the canary pipeline first',
          categories: ['deploy', 'auto-learned'],
          scopes: ['team'],
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ],
    })
    expectChipContract(frame)
  })

  test('degraded vendor event: absent enrichment falls back, never throws', () => {
    // A vendor that reports only id/title/action still yields a well-formed
    // frame (the desktop chip requires the full ingest-item shape).
    const frame = renderMemorySavedFrame({
      eventId: 'e1',
      sessionId: SESSION,
      event: { id: 'm1', title: 'sparse vendor save', action: 'created' },
      nowIso: '2026-07-25T00:00:00.000Z',
    })

    expectChipContract(frame)
    expect((frame.memories as Record<string, unknown>[])[0]).toEqual({
      id: 'm1',
      type: 'fact',
      title: 'sparse vendor save',
      text: 'sparse vendor save',
      categories: [],
      scopes: ['personal'],
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z',
    })
  })
})
