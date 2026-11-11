import assert from 'node:assert/strict'
import { test } from 'node:test'

import { openInputRequests, openQuestionCount } from './agentInputRequests.ts'

test('only open requests are listed, oldest first', () => {
  assert.deepEqual(openInputRequests({}), [])
  const request = (id: string, askedAt: string, status: 'open' | 'answered' = 'open') => ({
    id,
    category: 'preference',
    question: id,
    askedAt,
    status,
  })
  const open = openInputRequests({
    inputRequests: [
      request('later', '2026-10-27T03:00:00Z'),
      request('done', '2026-10-27T00:00:00Z', 'answered'),
      request('question-1', '2026-10-27T01:00:00Z'),
    ],
  })

  assert.deepEqual(
    open.map((entry) => entry.id),
    ['question-1', 'later'],
  )
})

test('a row counts its open questions beside the title only when there are several', () => {
  assert.equal(openQuestionCount(0), null)
  assert.equal(openQuestionCount(1), null)
  assert.equal(openQuestionCount(2), '2 questions')
  assert.equal(openQuestionCount(7), '7 questions')
})
