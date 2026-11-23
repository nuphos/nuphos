// A steered turn persists as interleaved segments: request messages, then
// assistant / user / assistant in the order the exchange actually happened.
// Enter the routes/agent module graph through its barrel first, so the
// constants ↔ run-pump-helpers cycle initializes in production order.
import '@/routes/agent'

import { describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

import type { AgentRun } from './types'
import type { UIMessage } from 'ai'

const persisted: { messages: { id: string; role: string; parts: unknown[] }[] }[] = []
const storedAt = new Date('2026-10-09T04:00:00.000Z')

useAgentDb({
  appendTranscriptMessages: (args) => {
    persisted.push({ messages: args.messages })

    return Promise.resolve({
      isNew: false,
      count: args.messages.length,
      lastIndex: args.messages.length - 1,
    })
  },
  // The finished turn reads back only its recent window.
  getConversationMessages: async (_session, _user, options) =>
    persisted
      .at(-1)!
      .messages.slice(-(options?.tail ?? Infinity))
      .map((message) => ({
        ...message,
        messageId: message.id,
        createdAt: message.id === 'old-answer' ? new Date('2026-10-08T04:00:00.000Z') : storedAt,
      })),
})

const { finishPreviewTurn, persistInterruptedPreviewTurn } = await import('./chat-preview-finish')

describe('finishPreviewTurn with steering segments', () => {
  test('persists assistant/user/assistant in exchange order', async () => {
    const frames: Record<string, unknown>[] = []
    const steered: UIMessage[] = [
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'answer 1' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: '改查 staging' }] },
    ]

    await finishPreviewTurn({
      run: { trace: undefined, streamId: 'stream' } as unknown as AgentRun,
      sessionId: 's1',
      teamId: 't1',
      userId: 'u1',
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'start' }] }],
      firstMessage: 'start',
      locale: 'en-US',
      provider: 'test',
      requestId: 'r1',
      text: 'answer 2',
      reasoning: '',
      toolSteps: [],
      finalStepStart: 0,
      steered,
      memory: null,
      emit: (frame) => {
        frames.push(frame)
      },
    })

    const roles = persisted[0]!.messages.map((message) => message.role)

    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(frames.find((frame) => frame.type === 'atlas-transcript-tail')).toEqual({
      type: 'atlas-transcript-tail',
      messages: persisted[0]!.messages.map((message) => ({
        ...message,
        createdAt: storedAt.toISOString(),
      })),
      messagesFirstIndex: 0,
    })
    expect(JSON.stringify(persisted[0]!.messages.at(-1))).toContain('answer 2')
    expect(JSON.stringify(persisted[0]!.messages[2])).toContain('改查 staging')
  })
})

for (const interrupted of [false, true]) {
  test(`tail keeps stored timestamps for historical and ${interrupted ? 'interrupted' : 'completed'} replies`, async () => {
    const frames: Record<string, unknown>[] = []
    const args = {
      run: {
        trace: undefined,
        streamId: 'stream',
        abortController: new AbortController(),
      } as unknown as AgentRun,
      sessionId: 'timestamps',
      teamId: 'team',
      userId: 'owner',
      messages: [
        {
          id: 'old-answer',
          role: 'assistant' as const,
          parts: [{ type: 'text' as const, text: 'Earlier files' }],
        },
      ],
      firstMessage: 'start',
      locale: 'en-US',
      provider: 'test',
      requestId: 'request',
      text: 'New files',
      reasoning: '',
      toolSteps: [],
      finalStepStart: 0,
      steered: [],
      memory: null,
      error: new Error('interrupted'),
      emit: (frame: Record<string, unknown>) => {
        frames.push(frame)
      },
    }

    if (interrupted) await persistInterruptedPreviewTurn(args)
    else await finishPreviewTurn(args)

    const tail = frames.find((frame) => frame.type === 'atlas-transcript-tail')?.messages as {
      id: string
      createdAt: string
    }[]

    expect(tail).toHaveLength(2)
    expect(tail[0]).toMatchObject({ id: 'old-answer', createdAt: '2026-10-08T04:00:00.000Z' })
    expect(tail[1]!.createdAt).toBe(storedAt.toISOString())
  })

  test(`tail of ${interrupted ? 'an interrupted' : 'a completed'} turn starts at its prompt, leaving earlier history out`, async () => {
    const frames: Record<string, unknown>[] = []
    const text = (value: string) => [{ type: 'text' as const, text: value }]
    const args = {
      run: {
        trace: undefined,
        streamId: 'stream',
        abortController: new AbortController(),
      } as unknown as AgentRun,
      sessionId: 'long',
      teamId: 'team',
      userId: 'owner',
      messages: [
        { id: 'u1', role: 'user' as const, parts: text('first question') },
        { id: 'a1', role: 'assistant' as const, parts: text('first answer') },
        { id: 'u2', role: 'user' as const, parts: text('second question') },
      ],
      firstMessage: 'first question',
      locale: 'en-US',
      provider: 'test',
      requestId: 'request',
      text: 'partial answer',
      reasoning: '',
      toolSteps: [],
      finalStepStart: 0,
      steered: [
        { id: 'a2', role: 'assistant' as const, parts: text('working') },
        { id: 'u3', role: 'user' as const, parts: text('steer') },
      ],
      memory: null,
      error: new Error('interrupted'),
      emit: (frame: Record<string, unknown>) => {
        frames.push(frame)
      },
    }

    if (interrupted) await persistInterruptedPreviewTurn(args)
    else await finishPreviewTurn(args)

    const frame = frames.find((entry) => entry.type === 'atlas-transcript-tail') as {
      messages: { id: string }[]
      messagesFirstIndex: number
    }

    expect(frame.messagesFirstIndex).toBe(2)
    expect(frame.messages.map((message) => message.id).slice(0, 3)).toEqual(['u2', 'a2', 'u3'])
    expect(frame.messages).toHaveLength(4)
  })
}

test('a completed turn without text or tools preserves its assistant completion boundary', async () => {
  await finishPreviewTurn({
    run: { trace: undefined, streamId: 'stream' } as unknown as AgentRun,
    sessionId: 'empty',
    teamId: 'team',
    userId: 'owner',
    messages: [{ id: 'question', role: 'user', parts: [{ type: 'text', text: 'start' }] }],
    firstMessage: 'start',
    locale: 'en-US',
    provider: 'test',
    requestId: 'empty-run',
    text: '',
    reasoning: '',
    orderedParts: [],
    toolSteps: [],
    finalStepStart: 0,
    steered: [],
    memory: null,
    emit: () => {},
  })
  expect(persisted.at(-1)!.messages).toEqual([
    { id: 'question', role: 'user', parts: [{ type: 'text', text: 'start' }] },
    // The reply is stored under its run's stream id, the id a client's live reply has.
    { id: 'stream', role: 'assistant', parts: [] },
  ])
})

describe('successful empty completion', () => {
  test.each(['_(no response)_', '(no response)', '   ', ''])(
    'persists a completion receipt without placeholder text: %s',
    async (text) => {
      const frames: Record<string, unknown>[] = []

      await finishPreviewTurn({
        run: { trace: undefined, streamId: 'stream' } as unknown as AgentRun,
        sessionId: 'silent',
        teamId: 't1',
        userId: 'u1',
        messages: [
          { id: 'delivery', role: 'user', parts: [{ type: 'text', text: 'progress notice' }] },
        ],
        firstMessage: 'progress notice',
        locale: 'en-US',
        provider: 'test',
        requestId: 'silent',
        text,
        reasoning: '',
        orderedParts: text ? [{ type: 'text', text }] : [],
        toolSteps: [],
        finalStepStart: 0,
        steered: [],
        memory: null,
        emit: (frame) => {
          frames.push(frame)
        },
      })
      const last = persisted.at(-1)!.messages.at(-1)!

      expect(last.role).toBe('assistant')
      expect(last.parts).toEqual([])
      expect(JSON.stringify(frames)).not.toContain('no response')
    },
  )
})
