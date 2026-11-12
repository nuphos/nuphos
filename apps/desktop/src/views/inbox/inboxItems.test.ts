import assert from 'node:assert/strict'
import test from 'node:test'

import { answeredIn, inboxCount, inboxQuestions, markAsDone, openQuestion } from './inboxItems.ts'

import type { AgentConversation } from '../../api/agent-types.ts'

// Each question id is also its time, so a later id was asked later.
const waiting = (sessionId: string, ...ids: string[]) =>
  ({
    sessionId,
    isOwner: true,
    inputRequests: ids.map((id) => ({
      id,
      category: 'approval',
      question: id,
      askedAt: `2026-10-30T00:00:00Z ${id}`,
      status: 'open',
    })),
  }) as AgentConversation

test('the count is the open questions, each leaving it once answered here', () => {
  const listing = [waiting('a', 'q1'), waiting('b', 'q2', 'q3')]

  // Three questions in two conversations count three: one per row and per card.
  assert.equal(inboxCount(listing, new Map()), 3)
  assert.equal(inboxCount(listing, new Map([['q1', Infinity]])), 2)
  assert.equal(inboxCount(listing, new Map([['q2', Infinity]])), 2)
})

test("the Inbox lists only the viewer's own conversations' questions", () => {
  const shared = { ...waiting('b', 'q9'), isOwner: false }

  assert.deepEqual(
    inboxQuestions([waiting('a', 'q1'), shared], new Map()).map((row) => row.request.id),
    ['q1'],
  )
})

test('the Inbox lists every open question, newest first, without those answered here', () => {
  const listing = [waiting('a', 'q1', 'q3'), waiting('b', 'q2')]
  const ids = (answered: Map<string, number>) =>
    inboxQuestions(listing, answered).map(
      (row) => `${row.conversation.sessionId}:${row.request.id}`,
    )

  assert.deepEqual(ids(new Map()), ['a:q3', 'b:q2', 'a:q1'])
  assert.deepEqual(ids(new Map([['q3', Infinity]])), ['b:q2', 'a:q1'])
})

test('the Inbox keeps the open question, and opens the next row once it is answered', () => {
  const rows = inboxQuestions([waiting('a', 'q1', 'q2', 'q3')], new Map())

  // The first listing opens the top row; an empty Inbox opens nothing.
  assert.equal(openQuestion(rows, null)?.request.id, 'q3')
  assert.equal(openQuestion([], null), undefined)
  assert.equal(openQuestion(rows, { id: 'q2', index: 1 })?.request.id, 'q2')
  // q2 answered: the row that took its place opens, else the last one.
  const rest = rows.filter((row) => row.request.id !== 'q2')

  assert.equal(openQuestion(rest, { id: 'q2', index: 1 })?.request.id, 'q1')
  assert.equal(openQuestion(rest, { id: 'q1', index: 2 })?.request.id, 'q1')
})

test('a listing settles answers it no longer has open, and those past their deadline', () => {
  const answered = new Map([
    ['gone', Infinity],
    ['sending', Infinity],
    ['sent', 2_000],
    ['stale', 500],
  ])
  const listing = [waiting('a', 'sending', 'sent', 'stale')]

  assert.deepEqual(answeredIn(listing, answered, 1_000), ['gone', 'stale'])
})

test('a to-do is marked done; a choice, a secret or a connection is not', () => {
  // Marking a to-do done answers it like any reply, so the agent goes on.
  assert.equal(markAsDone({ category: 'approval' }), true)
  assert.equal(markAsDone({ category: 'preference', options: ['us-east-1', 'eu-west-1'] }), false)
  assert.equal(markAsDone({ category: 'credential' }), false)
  assert.equal(markAsDone({ category: 'integration' }), false)
})
