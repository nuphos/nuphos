import assert from 'node:assert/strict'
import test from 'node:test'

import { listingFor, nextSelection, openQuestionCount, replyTarget } from './inboxItems.ts'

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

test("after a team switch the last team's count is not shown", () => {
  const listing = { teamId: 'team-a', count: 2, requestNo: 1 }

  assert.equal(listingFor(listing, 'team-b'), null)
  assert.equal(listingFor(listing, 'team-a'), listing)
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

test('a row counts its open questions beside the title only when there are several', () => {
  assert.equal(openQuestionCount(0), null)
  assert.equal(openQuestionCount(1), null)
  assert.equal(openQuestionCount(2), '2 questions')
  assert.equal(openQuestionCount(7), '7 questions')
})
