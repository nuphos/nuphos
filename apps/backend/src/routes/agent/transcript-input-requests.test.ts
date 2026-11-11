import { expect, test } from 'bun:test'

import { serializeConversationDoc } from './transcript'

const askedAt = (hour: number) => new Date(`2026-10-27T0${String(hour)}:00:00Z`)

test('responses carry every open request, oldest first', () => {
  const body = serializeConversationDoc({
    sessionId: 's1',
    inputRequests: [
      {
        id: 'q2',
        category: 'preference',
        question: 'Palette?',
        askedAt: askedAt(2),
        status: 'open',
      },
      {
        id: 'q0',
        category: 'preference',
        question: 'Done',
        askedAt: askedAt(0),
        status: 'answered',
      },
      { id: 'q1', category: 'approval', question: 'Merge?', askedAt: askedAt(1), status: 'open' },
    ],
  })

  expect((body.inputRequests as { id: string }[]).map((request) => request.id)).toEqual([
    'q1',
    'q2',
  ])
  expect(body).not.toHaveProperty('pendingDecision')
})

test('the field kept before request lists is never sent, and nothing open sends no requests', () => {
  const legacy = serializeConversationDoc({
    sessionId: 's1',
    pendingDecision: {
      category: 'approval',
      question: 'Merge?',
      toolCallId: 'q1',
      askedAt: askedAt(1),
    },
  })

  expect(legacy).not.toHaveProperty('inputRequests')
  expect(legacy).not.toHaveProperty('pendingDecision')

  const resolved = serializeConversationDoc({
    sessionId: 's1',
    inputRequests: [
      {
        id: 'q0',
        category: 'approval',
        question: 'Done',
        askedAt: askedAt(0),
        status: 'dismissed',
      },
    ],
  })

  expect(resolved).not.toHaveProperty('inputRequests')
  expect(resolved).not.toHaveProperty('pendingDecision')
})

test('a question a queued message answers is no longer listed as open, so the badge clears', () => {
  const question = {
    category: 'preference',
    question: 'Public?',
    askedAt: askedAt(1),
    status: 'open',
  }
  const body = serializeConversationDoc(
    {
      sessionId: 's1',
      inputRequests: [
        { ...question, id: 'q1' },
        { ...question, id: 'q2' },
      ],
    },
    new Set(['q1']),
  )

  expect((body.inputRequests as { id: string }[]).map((request) => request.id)).toEqual(['q2'])
  const all = serializeConversationDoc(
    { sessionId: 's1', inputRequests: [{ ...question, id: 'q1' }] },
    new Set(['q1']),
  )

  expect(all.inputRequests).toBeUndefined()
  expect(all.pendingDecision).toBeUndefined()
})

test("a request for the member's own credential reaches clients with its exact target", () => {
  const credentials = [{ provider: 'personal' as const, id: 'github' as const }]
  const body = serializeConversationDoc({
    sessionId: 's1',
    inputRequests: [
      {
        id: 'q1',
        category: 'integration',
        question: 'Select your own GitHub',
        credentials,
        askedAt: askedAt(1),
        status: 'open',
      },
    ],
  })

  expect((body.inputRequests as { credentials?: unknown }[])[0]?.credentials).toEqual(credentials)
})
