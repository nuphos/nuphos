import assert from 'node:assert/strict'
import test from 'node:test'

import { answeredIn, cardReplies, inboxCount, nextSelection, replyTarget } from './inboxItems.ts'

import type { AgentConversation } from '../../api/agent-types.ts'

const chats = (...ids: string[]) => ids.map((sessionId) => ({ sessionId }) as AgentConversation)

test('the first listing opens the top conversation; an empty Inbox opens nothing', () => {
  assert.equal(nextSelection(null, chats('a', 'b')), 'a')
  assert.equal(nextSelection(null, []), null)
})

test('the open conversation stays open while it still waits', () => {
  assert.equal(nextSelection({ sessionId: 'b', index: 1 }, chats('a', 'b', 'c')), 'b')
})

test('once answered it leaves the list and the next one opens', () => {
  assert.equal(nextSelection({ sessionId: 'b', index: 1 }, chats('a', 'c')), 'c')
  // The last one answered: the one above it opens.
  assert.equal(nextSelection({ sessionId: 'c', index: 2 }, chats('a', 'b')), 'b')
})

test('a conversation pushed out of the listing stays open while it still waits', () => {
  // Listed at index 1, then newer questions pushed it past the page: its own record says it waits.
  assert.equal(nextSelection({ sessionId: 'b', index: 1 }, chats('x', 'y', 'a'), true), 'b')
  // The same displacement after it was answered: the next one opens.
  assert.equal(nextSelection({ sessionId: 'b', index: 1 }, chats('x', 'y', 'a'), false), 'y')
})

test('an off-page conversation, once answered, hands over to the first row', () => {
  // Opened (or kept) beyond the listed rows, so its index is -1.
  assert.equal(nextSelection({ sessionId: 'z', index: -1 }, chats('a', 'b'), false), 'a')
})

const waiting = (sessionId: string, ...ids: string[]) =>
  ({
    sessionId,
    inputRequests: ids.map((id) => ({
      id,
      category: 'approval',
      question: id,
      askedAt: '2026-10-30T00:00:00Z',
      status: 'open',
    })),
  }) as AgentConversation

test('a conversation leaves the count once every question in it is answered here', () => {
  const listing = [waiting('a', 'q1'), waiting('b', 'q2', 'q3')]

  assert.equal(inboxCount(listing, new Map()), 2)
  assert.equal(inboxCount(listing, new Map([['q1', Infinity]])), 1)
  // One of two questions answered: the conversation still waits.
  assert.equal(inboxCount(listing, new Map([['q2', Infinity]])), 2)
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

test('a reply answers the chosen open question, else the newest, as the chip does', () => {
  const ask = (id: string) => ({
    id,
    category: 'preference',
    question: id,
    askedAt: '2026-10-27T00:00:00Z',
    status: 'open' as const,
  })
  const open = [ask('oldest'), ask('newer')]

  assert.equal(replyTarget(open, null), 'newer')
  assert.equal(replyTarget(open, 'oldest'), 'oldest')
  assert.equal(replyTarget(open, 'answered-meanwhile'), 'newer')
  assert.equal(replyTarget([], 'newer'), undefined)
})

test('a card replies with its choices, a to-do with "Done.", and a secret only in the chat', () => {
  assert.deepEqual(cardReplies({ category: 'preference', options: ['us-east-1', 'eu-west-1'] }), [
    { label: 'us-east-1', reply: 'us-east-1' },
    { label: 'eu-west-1', reply: 'eu-west-1' },
  ])
  // Marking a to-do done answers it like any reply, so the agent goes on.
  assert.deepEqual(cardReplies({ category: 'approval' }), [
    { label: 'Mark as done', reply: 'Done.' },
  ])
  assert.equal(cardReplies({ category: 'credential' }), null)
  assert.equal(cardReplies({ category: 'integration', options: ['Connect'] }), null)
})
