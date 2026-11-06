import { beforeEach, describe, expect, test } from 'bun:test'

// The routes/agent barrel settles that package's import cycle; loading it
// first keeps the chat-prep double from tripping over a half-initialized
// constants module.
import '@/routes/agent'
import { createTurnMemoryAccumulator } from '@/lib/agent/memory-slots/turn-accumulator'
import { useChatPrep } from '@/lib/test/doubles/chat-prep'
import { useAttributionCapture } from '@/lib/test/doubles/memory-attribution-capture'

import type { TurnMemoryResult } from '@/routes/agent/chat-prep'

const turnMemory = {
  resolution: { kind: 'active', providerId: 'native', provider: {} },
  accumulator: null,
} as unknown as TurnMemoryResult

useChatPrep({
  buildTurnMemoryPromise: () => Promise.resolve(turnMemory),
})

const captured: unknown[] = []

useAttributionCapture({
  captureTurnAttribution: (input) => {
    captured.push(input)

    return Promise.resolve()
  },
})

const { finishPreviewTurnMemory, resolvePreviewTurnMemory } = await import('./chat-preview-memory')

const accumulator = () =>
  createTurnMemoryAccumulator({
    providerId: 'native',
    sessionId: 's1',
    userId: 'u1',
    teamId: 't1',
    requestId: 'r1',
    emitFrame: () => {},
    recordEvent: () => {},
  })

beforeEach(() => {
  captured.length = 0
})

describe('resolvePreviewTurnMemory', () => {
  test('resolves the provider', async () => {
    const memory = await resolvePreviewTurnMemory({
      sessionId: 's1',
      userId: 'u1',
      teamId: 't1',
      requestId: 'r1',
    })

    expect(memory.turnMemory).toBe(turnMemory)
  })
})

describe('finishPreviewTurnMemory', () => {
  test('feeds what the agent fetched to the provenance frame and attribution', async () => {
    const emitted: Record<string, unknown>[] = []
    const acc = accumulator()

    acc.observer.fetched({ id: 'm2', scope: 'personal', label: 'prod-a uses m7i-flex' })
    await finishPreviewTurnMemory({
      sessionId: 's1',
      userId: 'u1',
      teamId: 't1',
      requestId: 'r1',
      memory: { turnMemory: { ...turnMemory, accumulator: acc } },
      emitFrame: (frame) => emitted.push(frame),
    })

    expect(emitted).toEqual([
      {
        type: 'memory-provenance',
        sessionId: 's1',
        turnKey: 'r1',
        fetchedIds: ['m2'],
        fetchedTeamIds: [],
        fetchedPersonalIds: ['m2'],
        labels: { m2: 'prod-a uses m7i-flex' },
      },
    ])
    expect(captured[0]).toMatchObject({
      provider: 'native',
      conversationId: 's1',
      turnKey: 'r1',
      fetchedPersonalIds: ['m2'],
    })
  })

  test('a turn that fetched nothing emits no frame but still records the turn', async () => {
    const emitted: Record<string, unknown>[] = []

    await finishPreviewTurnMemory({
      sessionId: 's1',
      userId: 'u1',
      teamId: 't1',
      requestId: 'r2',
      memory: { turnMemory: { ...turnMemory, accumulator: accumulator() } },
      emitFrame: (frame) => emitted.push(frame),
    })

    expect(emitted).toHaveLength(0)
    expect(captured).toHaveLength(1)
  })

  test('memory off for the turn (no accumulator) records nothing', async () => {
    await finishPreviewTurnMemory({
      sessionId: 's1',
      userId: 'u1',
      teamId: 't1',
      requestId: 'r3',
      memory: { turnMemory },
    })

    expect(captured).toHaveLength(0)
  })
})
