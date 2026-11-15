// Same init-order guard as the sibling preview tests.
import '@/routes/agent'

import { beforeEach, describe, expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useClaimOrEnqueue } from '@/lib/test/doubles/claim-or-enqueue'
import { useConversationComputer } from '@/lib/test/doubles/conversation-computer'
import { useDecisionAnswer } from '@/lib/test/doubles/decision-answer'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useMessageAttribution } from '@/lib/test/doubles/message-attribution'
import { useTriggerRunExecute } from '@/lib/test/doubles/trigger-run-execute'

import type { AgentConversation } from '@/lib/agent/db'

const session = (userId = 'a'.repeat(24)) =>
  ({ sessionId: 's1', userId, teamId: 't1', title: 'Fix the importer' }) as AgentConversation

let stored: AgentConversation | null
let participant: boolean
let answered: { requestId: string; answer: unknown; actor: string }[]
let refuse: AppError | undefined
let runs: Record<string, unknown>[]
let finishRun: () => void
let claims: { userId: string; actorUserId?: string }[]

useIdentity({ getTeamMembership: async () => ({ role: 'MEMBER' }) as never })
useMessageAttribution({
  createMessageMetadata: async (userId) =>
    ({ version: 1, sender: { type: 'user', id: userId, displayName: 'Ada' } }) as never,
})
useConversationComputer({ canReplyIn: async () => participant })
useDecisionAnswer({
  answerDecision: async ({ requestId, answer, actor }) => {
    if (refuse) throw refuse
    answered.push({ requestId, answer, actor: actor.id })
  },
})
useClaimOrEnqueue({
  claimAgentRunOrEnqueue: async ({ userId, message }) => {
    claims.push({ userId, actorUserId: message.actorUserId })

    return { mode: 'run', release: () => undefined, carried: [] }
  },
})
useTriggerRunExecute({
  executeAgentForTrigger: async (params) => {
    runs.push(params as unknown as Record<string, unknown>)
    await new Promise<void>((resolve) => {
      finishRun = resolve
    })

    return { status: 'completed', finishReason: 'stop' } as never
  },
})
useAgentDb({
  getConversationBySessionId: async () => stored,
  getReadableConversation: async () => (participant ? stored : null),
  getConversationWithMessages: async () =>
    stored && {
      conversation: stored,
      messages: [{ role: 'assistant', parts: [{ type: 'text', text: 'Done.' }] }] as never,
    },
})

const { nuphosAsk } = await import('./ask')
const ME = 'a'.repeat(24)
const ctx = { userId: ME }
const body = (result: { structuredContent?: unknown }) =>
  result.structuredContent as Record<string, any>
const answer = { prompt: 'eu', team_id: 't1', session_id: 's1', request_id: 'q1' }

beforeEach(() => {
  stored = session()
  participant = false
  answered = []
  refuse = undefined
  runs = []
  claims = []
  finishRun = () => undefined
})

describe('nuphos_ask request_id', () => {
  test('answers the open question instead of sending a message', async () => {
    const result = body(await nuphosAsk(answer, ctx))

    expect(result).toMatchObject({ status: 'running', session_id: 's1' })
    expect(answered).toEqual([{ requestId: 'q1', answer: { text: 'eu' }, actor: ME }])
    expect(runs).toEqual([])
  })

  test('a question that must be answered in its own card is a tool error', async () => {
    refuse = new AppError(400, 'decision_not_answerable', 'Answer this question in its own card')
    const result = await nuphosAsk(answer, ctx)

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: 'Answer this question in its own card' })
  })
})

describe('nuphos_ask on a teammate’s session', () => {
  test('is not found for someone who cannot reply in it', async () => {
    stored = session('owner')
    const result = await nuphosAsk(answer, ctx)

    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ text: 'Session not found: s1' })
    expect(answered).toEqual([])
  })

  test('a participant may answer, and their turn runs in the owner’s session', async () => {
    stored = session('owner')
    participant = true

    expect(body(await nuphosAsk(answer, ctx)).status).toBe('running')
    expect(answered).toHaveLength(1)

    const sent = nuphosAsk({ prompt: 'Use eu.', team_id: 't1', session_id: 's1', wait: false }, ctx)

    expect(body(await sent)).toMatchObject({ status: 'running', session_id: 's1' })
    // The session's queue is its owner's; the message stays the participant's.
    expect(claims).toEqual([{ userId: 'owner', actorUserId: ME }])
    expect(runs[0]).toMatchObject({
      userId: ME,
      conversationOwnerUserId: 'owner',
      sessionId: 's1',
      source: 'mcp',
    })
    finishRun()
  })

  test('a session in another team is not found', async () => {
    stored = { ...session('owner'), teamId: 't2' } as AgentConversation
    participant = true

    expect((await nuphosAsk(answer, ctx)).isError).toBe(true)
  })
})

describe('nuphos_ask wait', () => {
  test('false returns once the turn is accepted; the default waits for the answer', async () => {
    stored = null
    const started = body(await nuphosAsk({ prompt: 'Go.', team_id: 't1', wait: false }, ctx))

    expect(started.status).toBe('running')
    expect(runs).toHaveLength(1)
    finishRun()

    stored = session()
    const waiting = nuphosAsk({ prompt: 'Go.', team_id: 't1', session_id: 's1' }, ctx)

    await new Promise((resolve) => setTimeout(resolve, 20))
    finishRun()
    expect(body(await waiting)).toMatchObject({ status: 'completed', answer: 'Done.' })
  })
})
