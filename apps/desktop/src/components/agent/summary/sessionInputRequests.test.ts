import assert from 'node:assert/strict'
import { test } from 'node:test'

import { botQuestions, inputRequestKey, sessionInputRequests } from './sessionInputRequests.ts'

import type { AgentConversation } from '../../../api/agent-types.ts'

function chat(id: string, parentSessionId?: string, question?: string): AgentConversation {
  return {
    sessionId: id,
    title: id,
    parentSessionId,
    firstMessage: '',
    messageCount: 1,
    createdAt: '2026-10-27T00:00:00Z',
    lastActiveAt: '2026-10-27T00:00:00Z',
    ...(question
      ? {
          pendingDecision: {
            category: 'preference',
            question,
            toolCallId: `question-${id}`,
            askedAt: '2026-10-27T01:00:00Z',
          },
        }
      : {}),
  }
}

test('lists explicit questions from seven children, the parent and nested agents only', () => {
  const children = Array.from({ length: 7 }, (_, i) =>
    chat(`agent-${String(i)}`, 'parent', 'Choose a direction'),
  )
  const conversations = [
    ...children,
    chat('parent', undefined, 'Parent question'),
    chat('nested', 'agent-0', 'Nested question'),
    chat('unrelated', 'other-parent', 'Another team task'),
    chat('idle', 'parent'),
  ]
  const requests = sessionInputRequests('parent', conversations)

  assert.equal(requests.length, 9)
  assert.equal(
    requests.some((request) => request.sessionId === 'unrelated'),
    false,
  )
  assert.equal(
    requests.some((request) => request.sessionId === 'idle'),
    false,
  )
})

test('new arrivals append without activity changes reordering the current questions', () => {
  const first = chat('first', 'parent', 'First question')
  const second = chat('second', 'parent', 'Second question')
  const arriving = chat('arriving', 'parent', 'New question')

  assert.ok(second.pendingDecision)
  assert.ok(arriving.pendingDecision)
  second.pendingDecision.askedAt = '2026-10-27T02:00:00Z'
  arriving.pendingDecision.askedAt = '2026-10-27T03:00:00Z'
  first.lastActiveAt = '2026-10-27T05:00:00Z'
  const ids = sessionInputRequests('parent', [arriving, second, first]).map(
    (request) => request.sessionId,
  )

  assert.deepEqual(ids, ['first', 'second', 'arriving'])
})

test('a fresh answered listing removes the pending record instead of duplicating it', () => {
  const old = chat('agent', 'parent', 'Question')
  const answered = chat('agent', 'parent')

  assert.deepEqual(sessionInputRequests('parent', [old, answered]), [])
})

test('every open question of one agent is listed, each with its own identity', () => {
  const agent = chat('agent', 'parent')
  const ask = (id: string, askedAt: string) => ({
    id,
    category: 'preference',
    question: id,
    askedAt,
    status: 'open' as const,
  })

  agent.inputRequests = [
    ask('later', '2026-10-27T03:00:00Z'),
    ask('earlier', '2026-10-27T02:00:00Z'),
  ]
  const requests = sessionInputRequests('parent', [agent, chat('other', 'parent', 'Other')])

  assert.deepEqual(
    requests.map((request) => request.inputRequest.id),
    ['question-other', 'earlier', 'later'],
  )
  assert.equal(new Set(requests.map(inputRequestKey)).size, 3)
})

test('cyclic ancestry terminates', () => {
  assert.deepEqual(sessionInputRequests('parent', [chat('a', 'b', 'A'), chat('b', 'a', 'B')]), [])
})

test("switching Bot chats draws only the new Bot's listed questions, never a cached or foreign one", () => {
  // The sidebar cache still holds questions answered long ago, and says who sits under whom.
  const known = [
    chat('bot-a', undefined, 'A, answered long ago'),
    chat('a-mid', 'bot-a'),
    chat('bot-b', undefined, 'B, answered long ago'),
    chat('b-mid', 'bot-b'),
  ]
  // The pending listing every chat shares: what is open now.
  const pending = [
    chat('bot-a', undefined, 'A asks'),
    chat('a-leaf', 'a-mid', 'A grandchild asks'),
    chat('b-leaf', 'b-mid', 'B grandchild asks'),
  ]
  const shown = (botId: string) =>
    botQuestions(botId, pending, known, new Map()).map((r) => r.inputRequest.question)

  assert.deepEqual(shown('bot-a').sort(), ['A asks', 'A grandchild asks'])
  // Switched to B: nothing of A's, and not B's stale cached question.
  assert.deepEqual(shown('bot-b'), ['B grandchild asks'])
  // Before the listing loads, the chat draws nothing rather than the cache.
  assert.deepEqual(botQuestions('bot-b', [], known, new Map()), [])
  // A question answered on this device leaves at once.
  assert.deepEqual(botQuestions('bot-b', pending, known, new Map([['question-b-leaf', 1]])), [])
})
