import { beforeEach, describe, expect, test } from 'bun:test'

// The routes/agent barrel settles that package's import cycle; loading it
// first keeps the chat-prep double from tripping over a half-initialized
// constants module.
import '@/routes/agent'
import { createTurnMemoryAccumulator } from '@/lib/agent/memory-slots/turn-accumulator'
import { useChatPrep } from '@/lib/test/doubles/chat-prep'
import { useAttributionCapture } from '@/lib/test/doubles/memory-attribution-capture'
import { useAttributionJudge } from '@/lib/test/doubles/memory-attribution-judge'

import type { TurnMemoryResult } from '@/routes/agent/chat-prep'
import type { UIMessage } from 'ai'

const turnMemory = {
  resolution: { kind: 'active', providerId: 'native', provider: {} },
  accumulator: null,
} as unknown as TurnMemoryResult

useChatPrep({
  buildTurnMemoryPromise: () => Promise.resolve(turnMemory),
})

const captured: unknown[] = []
const judged: unknown[] = []

useAttributionCapture({
  captureTurnAttribution: (input) => {
    captured.push(input)

    return Promise.resolve()
  },
})
useAttributionJudge({
  runAttributionJudge: (input) => {
    judged.push(input)

    return Promise.resolve()
  },
})

const { finishPreviewTurnMemory, resolvePreviewTurnMemory } = await import('./chat-preview-memory')

const messages = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'which cluster is prod?' }] },
] as unknown as UIMessage[]

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
  judged.length = 0
})

describe('resolvePreviewTurnMemory', () => {
  test('resolves the provider and keeps the raw query for the judge', async () => {
    const memory = await resolvePreviewTurnMemory({
      sessionId: 's1',
      userId: 'u1',
      teamId: 't1',
      requestId: 'r1',
      messages,
    })

    expect(memory.turnMemory).toBe(turnMemory)
    expect(memory.memoryQuery).toBe('which cluster is prod?')
  })
})

describe('finishPreviewTurnMemory', () => {
  test('feeds what the agent fetched to the provenance frame, attribution, and the judge', async () => {
    const emitted: Record<string, unknown>[] = []
    const acc = accumulator()

    acc.observer.fetched({ id: 'm2', scope: 'personal', label: 'prod-a uses m7i-flex' })
    await finishPreviewTurnMemory({
      sessionId: 's1',
      userId: 'u1',
      teamId: 't1',
      requestId: 'r1',
      memory: { turnMemory: { ...turnMemory, accumulator: acc }, memoryQuery: 'which is prod?' },
      answer: 'prod-a',
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
    expect(judged[0]).toMatchObject({
      query: 'which is prod?',
      answer: 'prod-a',
      fetchedLabels: new Map([['m2', 'prod-a uses m7i-flex']]),
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
      memory: { turnMemory: { ...turnMemory, accumulator: accumulator() }, memoryQuery: 'hi' },
      answer: 'hello',
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
      memory: { turnMemory, memoryQuery: 'hi' },
      answer: 'hello',
    })

    expect(captured).toHaveLength(0)
    expect(judged).toHaveLength(0)
  })
})
