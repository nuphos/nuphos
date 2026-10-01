import { describe, expect, test } from 'bun:test'

// The routes/agent barrel settles that package's import cycle; loading it
// first keeps the chat-prep double from tripping over a half-initialized
// constants module.
import '@/routes/agent'
import { createTurnMemoryAccumulator } from '@/lib/agent/memory-slots/turn-accumulator'
import { useChatPrep } from '@/lib/test/doubles/chat-prep'
import { useDb } from '@/lib/test/doubles/db'
import { useAttributionCapture } from '@/lib/test/doubles/memory-attribution-capture'
import { useAttributionJudge } from '@/lib/test/doubles/memory-attribution-judge'
import { useMemoryIngestDispatch } from '@/lib/test/doubles/memory-ingest-dispatch'

import type { TurnDigest } from '@/lib/agent/memory-slots/types-ingest'
import type { MemoryRecallResult, TurnMemoryResult } from '@/routes/agent/chat-prep'
import type { UIMessage } from 'ai'

const recallQueries: string[] = []
const turnMemory = {
  resolution: { kind: 'active', providerId: 'native', provider: {} },
  accumulator: null,
} as unknown as TurnMemoryResult
const recall: MemoryRecallResult = {
  memoryBlock: '<memory>Cluster prod-a is the main one.</memory>',
  lastMemoryRollup: { used: true, count: 1, retrieveMs: 3, recalledTeamIds: ['m1'] },
  memoryPlacement: 'user-message-tail',
}

useChatPrep({
  buildTurnMemoryPromise: () => Promise.resolve(turnMemory),
  buildMemoryPromise: (args) => {
    recallQueries.push(args.recallQuery)

    return Promise.resolve(args.memoryRecallPlanned ? recall : { ...recall, memoryBlock: null })
  },
})

const distillUpdates: { filter: unknown; update: unknown }[] = []

useDb({
  db: () =>
    ({
      collection: () => ({
        updateOne: (filter: unknown, update: unknown) => {
          distillUpdates.push({ filter, update })

          return Promise.resolve({})
        },
      }),
    }) as never,
})

const captured: unknown[] = []
const judged: unknown[] = []
const digests: TurnDigest[] = []

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
useMemoryIngestDispatch({
  dispatchTurnIngest: (_resolution, digest) => {
    digests.push(digest)

    return Promise.resolve()
  },
})

const { ingestPreviewTurn, prefixUserMessage, recallForPreviewTurn } =
  await import('./preview-recall')

const messages = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'which cluster is prod?' }] },
] as unknown as UIMessage[]

describe('recallForPreviewTurn', () => {
  test('runs the classic recall and hands back the block plus the raw query', async () => {
    const memory = await recallForPreviewTurn({
      sessionId: 's1',
      userId: 'u1',
      teamId: 't1',
      requestId: 'r1',
      messages,
    })

    expect(recallQueries).toEqual(['which cluster is prod?'])
    expect(memory.memoryQuery).toBe('which cluster is prod?')
    expect(memory.recall.memoryBlock).toContain('prod-a')
  })

  test('a tagged plan approval is not the query; the request it approved is', async () => {
    recallQueries.length = 0
    const memory = await recallForPreviewTurn({
      sessionId: 's1',
      userId: 'u1',
      teamId: 't1',
      requestId: 'r2',
      messages: [
        ...messages,
        {
          id: 'u2',
          role: 'user',
          metadata: { turnKind: 'plan-approval' },
          parts: [{ type: 'text', text: 'Approved plan #477 — please proceed with plan #477.' }],
        },
      ] as unknown as UIMessage[],
    })

    expect(recallQueries).toEqual(['which cluster is prod?'])
    expect(memory.planApproval).toBe(true)
  })

  test('the same wording typed by the user is an ordinary turn', async () => {
    const memory = await recallForPreviewTurn({
      sessionId: 's1',
      userId: 'u1',
      teamId: 't1',
      requestId: 'r3',
      messages: [
        {
          id: 'u3',
          role: 'user',
          parts: [{ type: 'text', text: 'Approved plan #477 — please proceed with plan #477.' }],
        },
      ] as unknown as UIMessage[],
    })

    expect(memory.planApproval).toBe(false)
  })

  test('prefixUserMessage places the block after the user text, classic tail placement', () => {
    expect(prefixUserMessage('hello', '<memory>x</memory>')).toBe('hello\n\n<memory>x</memory>')
    expect(prefixUserMessage('hello', null)).toBe('hello')
  })
})

describe('ingestPreviewTurn', () => {
  test('feeds attribution, the judge, and the ingest digest with tool steps', async () => {
    const emitted: Record<string, unknown>[] = []
    const accumulator = createTurnMemoryAccumulator({
      providerId: 'native',
      sessionId: 's1',
      userId: 'u1',
      teamId: 't1',
      requestId: 'r1',
      emitFrame: () => {},
      recordEvent: () => {},
    })

    accumulator.noteRecall(
      {
        block: '<memory>Cluster prod-a is the main one.</memory>',
        recalled: [{ id: 'm1', scope: 'team', label: 'prod-a is the main cluster' }],
      },
      3,
    )
    accumulator.observer.fetched({
      id: 'm2',
      scope: 'personal',
      label: 'prod-a uses m7i-flex',
    })
    await ingestPreviewTurn({
      sessionId: 's1',
      userId: 'u1',
      teamId: 't1',
      requestId: 'r1',
      memory: {
        turnMemory: { ...turnMemory, accumulator },
        recall: { ...recall, recalledLabels: { m1: 'prod-a is the main cluster' } },
        memoryQuery: 'which cluster is prod?',
        planApproval: false,
      },
      answer: 'prod-a',
      toolSteps: [
        {
          toolCallId: 'tc-1',
          toolName: 'Bash',
          input: { command: 'kubectl ctx' },
          output: 'prod-a',
        },
      ],
      startedAt: Date.parse('2026-08-23T00:00:00Z'),
      emitFrame: (frame) => emitted.push(frame),
    })

    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      provider: 'native',
      conversationId: 's1',
      turnKey: 'r1',
      recalledTeamIds: ['m1'],
      fetchedPersonalIds: ['m2'],
    })
    expect(judged[0]).toMatchObject({
      query: 'which cluster is prod?',
      answer: 'prod-a',
      fetchedLabels: new Map([['m2', 'prod-a uses m7i-flex']]),
    })
    expect(emitted[0]).toMatchObject({
      type: 'memory-provenance',
      turnKey: 'r1',
      recalledTeamIds: ['m1'],
      fetchedIds: ['m2'],
      fetchedPersonalIds: ['m2'],
      labels: { m1: 'prod-a is the main cluster', m2: 'prod-a uses m7i-flex' },
    })
    expect(digests).toHaveLength(1)
    const digest = digests[0]!

    expect(digest.startedAt).toBe('2026-08-23T00:00:00.000Z')
    expect(digest.messages.some((m) => m.role === 'tool')).toBe(true)
    expect(JSON.stringify(digest.messages)).toContain('kubectl ctx')
  })

  test('a tagged plan approval is never an ingest source', async () => {
    digests.length = 0
    captured.length = 0
    await ingestPreviewTurn({
      sessionId: 's1',
      userId: 'u1',
      teamId: 't1',
      requestId: 'r4',
      memory: {
        turnMemory,
        recall,
        memoryQuery: 'Approved plan #477 — please proceed with plan #477.',
        planApproval: true,
      },
      answer: 'Executing plan #477.',
      toolSteps: [],
      startedAt: Date.now(),
    })

    expect(captured).toHaveLength(1)
    expect(digests).toHaveLength(0)
    expect(distillUpdates.at(-1)).toEqual({
      filter: { conversationId: 's1', turnKey: 'r4' },
      update: { $set: { distill: 'skipped_plan_approval' } },
    })
  })
})
