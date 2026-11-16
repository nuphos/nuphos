import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { systemSender } from './message-metadata'
import { buildPendingUserMessage } from './pending-messages'
import { deliverWaitingAnswers, keepWaitingAnswer, waitingNote } from './waiting-answers'

import type { AgentConversation } from './db'
import type { InputRequest } from './db/pending-decision'

let memory = portabilityDb()
const turns: { text: string; answers?: string }[] = []

useDb({ db: () => memory })
useAgentDb({
  getConversationBySessionId: async (sessionId: string) =>
    (memory.rows('agent_conversations') as AgentConversation[]).find(
      (row) => row.sessionId === sessionId,
    ) ?? null,
})
useConversationTurn({
  startConversationTurn: async (data, _target, text) => {
    turns.push({ text, answers: data.answers?.id })

    return { status: 'started', run: Promise.resolve(undefined) }
  },
})

const question = (id: string): InputRequest => ({
  id,
  category: 'preference',
  question: 'Which regions?',
  status: 'open',
  askedAt: new Date(),
})
const answer = (id: string) => ({
  ...buildPendingUserMessage({
    renderedText: `Your question (requestId ${id}) was answered from the Inbox.`,
    source: 'agent.resource',
    actorUserId: 'owner',
    metadata: systemSender('nuphos:decision', 'Nuphos'),
  }),
  answers: question(id),
})
const stored = () => memory.rows('agent_conversations')[0] as AgentConversation

beforeEach(() => {
  memory = portabilityDb()
  memory.rows('agent_conversations').push({
    sessionId: 's',
    userId: 'owner',
    teamId: 'team',
    runtimeId: 'r',
  } as AgentConversation)
  turns.length = 0
})

test('an answer its agent cannot run yet is kept, once per question, with why', async () => {
  await keepWaitingAnswer('s', answer('q1'), 'usage_limit', '2026-11-16T11:20:00.000Z')
  await keepWaitingAnswer('s', answer('q1'), 'usage_limit')

  expect(stored().waitingAnswers).toMatchObject([
    { requestId: 'q1', cause: 'usage_limit', resetsAt: '2026-11-16T11:20:00.000Z' },
  ])
  // Still answered: nothing puts it back on the open list.
  expect(stored().inputRequests).toBeUndefined()
})

test('a waiting answer reaches its agent exactly once, however many triggers fire', async () => {
  await keepWaitingAnswer('s', answer('q1'), 'offline')
  await keepWaitingAnswer('s', answer('q2'), 'auth')
  await Promise.all([deliverWaitingAnswers('s'), deliverWaitingAnswers('s')])
  await deliverWaitingAnswers('s')

  expect(turns).toEqual([
    { text: 'Your question (requestId q1) was answered from the Inbox.', answers: 'q1' },
    { text: 'Your question (requestId q2) was answered from the Inbox.', answers: 'q2' },
  ])
  expect(stored().waitingAnswers).toEqual([])
})

test('the card says what the answer waits for, in plain words', () => {
  expect(
    waitingNote({ cause: 'usage_limit', resetsAt: '2026-11-16T11:20:00.000Z' }, 'Claude Code'),
  ).toBe('Answered · waiting for Claude Code (out of usage until 11:20 UTC)')
  expect(waitingNote({ cause: 'auth' }, 'Codex')).toBe('Answered · waiting for Codex (signed out)')
  expect(waitingNote({ cause: 'offline' }, 'Mac mini')).toBe(
    'Answered · waiting for Mac mini (offline)',
  )
})
