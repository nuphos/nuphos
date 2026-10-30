// hydrateStoredPrefix reads the stored prefix by COUNT (sort+limit), so an
// index hole left by racing persists can't wedge the session; a genuine
// shortfall rejects with the stored count so the client can rebase instead of
// resending the full transcript.
import { describe, expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'

import type { UIMessage } from 'ai'

type StoredMessage = { messageId: string; role: 'user' | 'assistant'; parts: unknown[] }

const state: { stored: StoredMessage[]; lastCount: number | undefined; headReads: number } = {
  stored: [],
  lastCount: undefined,
  headReads: 0,
}

useAgentDb({
  getConversationMessagesHead: async (_sessionId: string, _userId: string, count: number) => {
    state.lastCount = count
    state.headReads++

    return state.stored.slice(0, count)
  },
  agentMessages: () => ({
    countDocuments: () => Promise.resolve(state.stored.length),
    find: () => ({ toArray: () => Promise.resolve([]) }),
  }),
})

const { acceptClientTail, hydrateStoredPrefix, validateChatBody } = await import('./chat-validate')

test('a first-turn model pick is trimmed, and anything else is refused', () => {
  const body = {
    id: 'new-chat',
    messages: [],
    initialSessionConfig: { model: ' opus ', fast: 'on' },
  }

  validateChatBody(body as never)
  expect(body.initialSessionConfig).toEqual({ model: 'opus', fast: 'on' })
  for (const initialSessionConfig of [{ fast: '' }, { tools: 'all' }, { effort: '' }, 'opus'])
    expect(() =>
      validateChatBody({ id: 'new-chat', messages: [], initialSessionConfig } as never),
    ).toThrow('initialSessionConfig')
})

test('accepts a per-conversation runtime or an omitted preference', () => {
  for (const agentRuntime of [undefined, 'claude-code', 'codex'] as const) {
    expect(() => validateChatBody({ id: 'new-chat', messages: [], agentRuntime })).not.toThrow()
  }
})

test('rejects invalid runtime preferences before accepting a chat', () => {
  for (const agentRuntime of [null, 'nuphos', '', 'other', 1, {}]) {
    expect(() =>
      validateChatBody({
        id: 'new-chat',
        messages: [],
        agentRuntime: agentRuntime as 'codex',
      }),
    ).toThrow('agentRuntime must be one of claude-code, codex, grok, antigravity, opencode')
  }
})

const stored = (id: string, role: 'user' | 'assistant' = 'user'): StoredMessage => ({
  messageId: id,
  role,
  parts: [{ type: 'text', text: id }],
})

describe('hydrateStoredPrefix', () => {
  test('reads the prefix by count and maps stored messages to transcript shape', async () => {
    state.stored = [stored('m1'), stored('m2', 'assistant'), stored('m3')]
    const prefix = await hydrateStoredPrefix('sess', 'owner', 2, [{ id: 'new-user' }])

    expect(state.lastCount).toBe(2)
    expect(prefix).toEqual([
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'm1' }] },
      { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'm2' }] },
    ])
  })

  test('rejects with the stored count when the store holds fewer than claimed', async () => {
    state.stored = [stored('m1'), stored('m2')]
    const error = await hydrateStoredPrefix('sess', 'owner', 5, []).then(
      () => null,
      (err: unknown) => err,
    )

    expect(error).toBeInstanceOf(AppError)
    const appError = error as AppError

    expect(appError.status).toBe(409)
    expect(appError.code).toBe('transcript_out_of_sync')
    expect(appError.details).toEqual({ storedMessageCount: 2 })
  })

  test('drops prefix entries whose id reappears in the incoming window', async () => {
    state.stored = [stored('m1'), stored('dup')]
    const prefix = await hydrateStoredPrefix('sess', 'owner', 2, [{ id: 'dup' }, { id: 'new' }])

    expect(prefix.map((message) => message.id)).toEqual(['m1'])
  })
})

describe('acceptClientTail', () => {
  const conversation = { sessionId: 'sess', userId: 'owner' } as never
  const tail: UIMessage[] = [{ id: 'm3', role: 'user', parts: [{ type: 'text', text: 'next' }] }]

  test('keeps the client tail as sent, without reading the stored prefix', async () => {
    state.stored = [stored('m1'), stored('m2', 'assistant')]
    state.headReads = 0
    const body = { id: 'sess', messages: tail, baseIndex: 2, resume: true }
    const view = await acceptClientTail(body, 'sess', 'owner', conversation)

    expect(view.map((message) => message.id)).toEqual(['m3'])
    expect(body.messages).toBe(tail)
    expect(state.headReads).toBe(0)
  })

  test('still answers 409 with the stored count when the client is ahead of the store', async () => {
    state.stored = [stored('m1')]
    const error = await acceptClientTail(
      { id: 'sess', messages: tail, baseIndex: 2, resume: true },
      'sess',
      'owner',
      conversation,
    ).then(
      () => null,
      (err: unknown) => err as AppError,
    )

    expect(error?.status).toBe(409)
    expect(error?.details).toEqual({ storedMessageCount: 1 })
  })
})
