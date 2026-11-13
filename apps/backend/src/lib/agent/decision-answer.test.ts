import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import type * as dbActual from '@/lib/db'

// Whether the open question is still open when the answer resolves it.
let matchedCount = 1
const turns: { text: string; sender: string; session: string }[] = []
const channelRecords: { sessionId: string; texts: string[]; sender: string }[] = []

// The conversations a question can be about, besides the asker's own.
const others: Record<string, Record<string, unknown>> = {
  reviewer: { userId: 'owner', teamId: 't1' },
  stranger: { userId: 'u2', teamId: 't1' },
  room: { userId: 'owner', teamId: 't1', kind: 'channel' },
}
// The conversations whose turn cannot start.
const unreachable = new Set<string>()
let reopened = 0

useDb({
  db: (() => ({
    collection: () => ({
      updateOne: async (filter: Record<string, unknown>) => {
        if (JSON.stringify(filter).includes('"answered"')) reopened++

        return { matchedCount }
      },
    }),
  })) as unknown as typeof dbActual.db,
})
useIdentity({ getTeamMembership: async () => ({ role: 'member' }) as never })
useAgentDb({
  getConversationBySessionId: async (sessionId) =>
    ({ sessionId, userId: 'owner', teamId: 't1', ...others[sessionId] }) as never,
  appendConversationMessages: async ({ sessionId, messages }) => {
    const [message] = messages as {
      parts: { text: string }[]
      metadata: { sender: { id: string } }
    }[]

    channelRecords.push({
      sessionId,
      texts: message!.parts.map((part) => part.text),
      sender: message!.metadata.sender.id,
    })
  },
  bumpConversationActivity: async () => {},
})
useConversationTurn({
  startConversationTurn: async (data, _target, text, _source, metadata) => {
    if (unreachable.has(data.targetSessionId)) throw new Error('runtime offline')
    turns.push({ text, sender: metadata?.sender.id ?? '', session: data.targetSessionId })

    return { status: 'started' as const, run: Promise.resolve(undefined) }
  },
})

const { answerDecision } = await import('./decision-answer')

const ask = (extra: Record<string, unknown> = {}, conversation: Record<string, unknown> = {}) =>
  ({
    ...conversation,
    sessionId: 'bot',
    userId: 'owner',
    teamId: 't1',
    inputRequests: [
      {
        id: 'q1',
        category: 'preference',
        question: 'Which regions?',
        options: ['us-east', 'eu-west'],
        status: 'open',
        askedAt: new Date(),
        ...extra,
      },
    ],
  }) as never
const actor = { id: 'owner', displayName: 'Yuanlin' }
const teammate = { id: 'u2', displayName: 'Sam' }

beforeEach(() => {
  matchedCount = 1
  turns.length = 0
  channelRecords.length = 0
  unreachable.clear()
  reopened = 0
})

test('an answer wakes the asking agent with the card and the answer, and sends no message', async () => {
  await answerDecision({
    conversation: ask({ about: ['res-1'] }, { linkedResources: [{ id: 'res-1' }] }),
    requestId: 'q1',
    answer: { choices: ['us-east', 'eu-west'] },
    actor,
    teamId: 't1',
  })

  expect(turns).toHaveLength(1)
  expect(turns[0]).toMatchObject({ session: 'bot', sender: 'nuphos:decision' })
  expect(turns[0]!.text).toContain('Your question (requestId q1) was answered')
  expect(turns[0]!.text).toContain('Answered by: "Yuanlin", this conversation\'s owner')
  expect(turns[0]!.text).toContain('Continue the task with this answer.')
  expect(turns[0]!.text).toContain('- Which regions? → us-east, eu-west')
  expect(turns[0]!.text).toContain('Options: us-east | eu-west')
  expect(turns[0]!.text).toContain('About: res-1')
  expect(channelRecords).toEqual([])
})

test('a question asked in a channel is recorded there without waking it, and the agent replies there', async () => {
  await answerDecision({
    conversation: ask({
      channelId: 'chan-1',
      questions: [{ question: 'Which regions?' }, { question: 'Keep the old cluster?' }],
    }),
    requestId: 'q1',
    answer: { questions: [{ choices: ['us-east'] }, { text: 'Keep it a week' }] },
    actor,
    teamId: 't1',
  })

  expect(channelRecords).toEqual([
    {
      sessionId: 'chan-1',
      texts: [
        'Yuanlin answered: Which regions? → us-east',
        'Yuanlin answered: Keep the old cluster? → Keep it a week',
      ],
      sender: 'nuphos:decision',
    },
  ])
  // One wake, the asking agent's: the record itself wakes no one.
  expect(turns).toHaveLength(1)
  expect(turns[0]!.text).toContain('reply there with channel_post')
})

test("a teammate's answer is told apart from the owner's", async () => {
  await answerDecision({
    conversation: ask(),
    requestId: 'q1',
    answer: { choices: ['us-east'] },
    actor: teammate,
    teamId: 't1',
  })

  expect(turns[0]!.text).toContain('Answered by: "Sam", a teammate, not this conversation\'s owner')
  expect(turns[0]!.text).toContain("never as the owner's approval")
  expect(turns[0]!.text).not.toContain('Continue the task with this answer.')
})

test('a secret or a connection is never answered with text here', async () => {
  for (const category of ['credential', 'integration'])
    await expect(
      answerDecision({
        conversation: ask({ category }),
        requestId: 'q1',
        answer: { text: 'sk-secret' },
        actor,
        teamId: 't1',
      }),
    ).rejects.toThrow('its own card')
  expect(turns).toEqual([])
})

test('an answered question, or one that lost the race, is refused and wakes no one', async () => {
  const answer = { choices: ['us-east'] }

  await expect(
    answerDecision({
      conversation: ask({ status: 'answered' }),
      requestId: 'q1',
      answer,
      actor,
      teamId: 't1',
    }),
  ).rejects.toThrow('no longer open')
  matchedCount = 0
  await expect(
    answerDecision({ conversation: ask(), requestId: 'q1', answer, actor, teamId: 't1' }),
  ).rejects.toThrow('no longer open')
  expect(turns).toEqual([])
})

test('a conversation the question is about is told the answer as Nuphos; a linked resource is not', async () => {
  await answerDecision({
    conversation: ask({ about: ['res-1', 'reviewer'] }, { linkedResources: [{ id: 'res-1' }] }),
    requestId: 'q1',
    answer: { choices: ['eu-west'] },
    actor,
    teamId: 't1',
  })

  expect(turns.map((turn) => turn.session)).toEqual(['bot', 'reviewer'])
  const told = turns[1]!

  expect(told.sender).toBe('nuphos:decision')
  expect(told.text).toContain(
    'A question about this conversation (requestId q1), asked by conversation bot',
  )
  expect(told.text).toContain('- Which regions? → eu-west')
  expect(told.text).toContain("this conversation's owner: it is their own answer.")
  expect(told.text).toContain('Act on this answer where it concerns your own work')
})

test("another member's conversation or a channel is never told", async () => {
  await answerDecision({
    conversation: ask({ about: ['stranger', 'room'] }),
    requestId: 'q1',
    answer: { choices: ['us-east'] },
    actor,
    teamId: 't1',
  })

  expect(turns.map((turn) => turn.session)).toEqual(['bot'])
})

test('a conversation that cannot be told leaves the question answered', async () => {
  unreachable.add('reviewer')
  await answerDecision({
    conversation: ask({ about: ['reviewer'] }),
    requestId: 'q1',
    answer: { choices: ['us-east'] },
    actor,
    teamId: 't1',
  })

  expect(turns.map((turn) => turn.session)).toEqual(['bot'])
  expect(reopened).toBe(0)
})
