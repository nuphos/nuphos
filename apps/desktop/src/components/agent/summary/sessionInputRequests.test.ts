import assert from 'node:assert/strict'
import { test } from 'node:test'

import { inputRequestKey, sessionInputRequests } from './sessionInputRequests.ts'

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

test('a replacement question has its own selection identity and cyclic ancestry terminates', () => {
  const first = chat('agent', 'parent', 'First')

  assert.ok(first.pendingDecision)
  const second = {
    ...first,
    pendingDecision: { ...first.pendingDecision, toolCallId: 'replacement' },
  }

  assert.notEqual(inputRequestKey(first), inputRequestKey(second))
  assert.deepEqual(sessionInputRequests('parent', [chat('a', 'b', 'A'), chat('b', 'a', 'B')]), [])
})
