import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
import { useDb } from '@/lib/test/doubles/db'

import type * as dbActual from '@/lib/db'

// Whether the open question is still open when the answer resolves it.
let matchedCount = 1
const turns: { text: string; sender: string; session: string }[] = []
const channelRecords: { sessionId: string; texts: string[]; sender: string }[] = []

useDb({
  db: (() => ({
    collection: () => ({ updateOne: async () => ({ matchedCount }) }),
  })) as unknown as typeof dbActual.db,
})
useAgentDb({
  getConversationBySessionId: async (sessionId) =>
    ({ sessionId, userId: 'owner', teamId: 't1' }) as never,
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
    turns.push({ text, sender: metadata?.sender.id ?? '', session: data.targetSessionId })

    return { status: 'started' as const, run: Promise.resolve(undefined) }
  },
})

const { answerDecision } = await import('./decision-answer')

const ask = (extra: Record<string, unknown> = {}) =>
  ({
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
const actor = { id: 'u1', displayName: 'Yuanlin' }

beforeEach(() => {
  matchedCount = 1
  turns.length = 0
  channelRecords.length = 0
})

test('an answer wakes the asking agent with the card and the answer, and sends no message', async () => {
  await answerDecision({
    conversation: ask({ about: ['res-1'] }),
    requestId: 'q1',
    answer: { choices: ['us-east', 'eu-west'] },
    actor,
    teamId: 't1',
  })

  expect(turns).toHaveLength(1)
  expect(turns[0]).toMatchObject({ session: 'bot', sender: 'nuphos:decision' })
  expect(turns[0]!.text).toContain('Yuanlin answered your question (requestId q1)')
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
