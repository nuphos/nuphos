import { expect, test } from 'bun:test'

import { serializeConversationDoc } from './transcript'

const askedAt = (hour: number) => new Date(`2026-10-27T0${String(hour)}:00:00Z`)

test('responses carry every open request, and the oldest as pendingDecision', () => {
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
  expect(body.pendingDecision).toEqual({
    category: 'approval',
    question: 'Merge?',
    toolCallId: 'q1',
    askedAt: askedAt(1),
  })
})

test('a legacy single question is listed too, and nothing open sends neither field', () => {
  const legacy = serializeConversationDoc({
    sessionId: 's1',
    pendingDecision: {
      category: 'approval',
      question: 'Merge?',
      toolCallId: 'q1',
      askedAt: askedAt(1),
    },
  })

  expect(legacy.inputRequests).toEqual([
    { id: 'q1', category: 'approval', question: 'Merge?', askedAt: askedAt(1), status: 'open' },
  ])
  expect(legacy.pendingDecision).toMatchObject({ toolCallId: 'q1' })

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
