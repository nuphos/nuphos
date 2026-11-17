import assert from 'node:assert/strict'
import test from 'node:test'

import {
  answeredIn,
  botAbove,
  inboxCount,
  inboxGroups,
  inboxQuestions,
  openQuestion,
} from './inboxItems.ts'

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

test('the Inbox groups open questions by who asked, newest first, without those answered here', () => {
  const listing = [waiting('a', 'q1', 'q3'), waiting('b', 'q2')]
  const ids = (answered: Map<string, number>) =>
    inboxQuestions(listing, answered).map(
      (row) => `${row.conversation.sessionId}:${row.request.id}`,
    )

  assert.deepEqual(ids(new Map()), ['a:q3', 'a:q1', 'b:q2'])
  assert.deepEqual(ids(new Map([['q3', Infinity]])), ['b:q2', 'a:q1'])
  assert.deepEqual(
    inboxGroups(inboxQuestions(listing, new Map())).map((group) =>
      group.map((row) => row.request.id),
    ),
    [['q3', 'q1'], ['q2']],
  )
})

test("a Bot's tasks list their questions in the Bot's group, as the sidebar files them", () => {
  const bot = { ...waiting('bot', 'q2'), avatar: 'face' }
  const task = { ...waiting('task', 'q1', 'q4'), parentSessionId: 'bot' }
  const subtask = { ...waiting('subtask', 'q5'), parentSessionId: 'task' }
  const nestedBot = { ...waiting('nested', 'q6'), avatar: 'face', parentSessionId: 'bot' }
  const orphan = { ...waiting('orphan', 'q7'), parentSessionId: 'unlisted' }
  const listing = [bot, task, subtask, nestedBot, orphan, waiting('alone', 'q3')]
  const byId = new Map(listing.map((row) => [row.sessionId, row]))
  const rows = inboxQuestions(listing, new Map(), (conversation) =>
    botAbove(conversation, byId, (row) => Boolean(row.avatar)),
  )

  // A Bot stands on its own even when nested; a task whose parents are not listed stays its own group.
  assert.deepEqual(
    inboxGroups(rows).map((group) =>
      group.map(
        (row) => `${row.bot?.sessionId ?? '-'}:${row.conversation.sessionId}:${row.request.id}`,
      ),
    ),
    [
      ['-:orphan:q7'],
      ['-:nested:q6'],
      ['bot:subtask:q5', 'bot:task:q4', '-:bot:q2', 'bot:task:q1'],
      ['-:alone:q3'],
    ],
  )
  assert.equal(inboxCount(listing, new Map()), 7)
})

test('the Inbox keeps the open question while newer ones are listed above it', () => {
  const rows = inboxQuestions([waiting('a', 'q1', 'q2', 'q3')], new Map())
  const later = inboxQuestions([waiting('a', 'q1', 'q2', 'q3', 'q4')], new Map())

  // Nothing picked yet: the top row opens; an empty Inbox opens nothing.
  assert.equal(openQuestion(rows, null)?.request.id, 'q3')
  assert.equal(openQuestion([], null), undefined)
  assert.equal(openQuestion(rows, 'q2')?.request.id, 'q2')
  // q4 is newer and listed first; q2 is still the one open.
  assert.equal(openQuestion(later, 'q2')?.request.id, 'q2')
  // A question no longer listed opens the top row.
  assert.equal(openQuestion(rows, 'gone')?.request.id, 'q3')
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

test('onboarding preferences stay in the Bot chat without entering the Inbox', () => {
  const bot = {
    ...waiting('new-bot', 'setup'),
    botOnboarding: 'active' as const,
    inputRequests: waiting('new-bot', 'setup').inputRequests!.map((r) => ({
      ...r,
      category: 'preference',
    })),
  }

  assert.equal(inboxCount([bot], new Map()), 0)
  assert.equal(inboxCount([{ ...bot, botOnboarding: 'completed' }], new Map()), 1)
  assert.equal(
    inboxCount(
      [
        {
          ...bot,
          inputRequests: [...bot.inputRequests, ...waiting('new-bot', 'approval').inputRequests!],
        },
      ],
      new Map(),
    ),
    1,
  )
})

test('legacy introduced Bots keep their normal Inbox questions', () => {
  const bot = { ...waiting('legacy', 'work'), botOnboarding: 'started' as const }

  assert.equal(inboxCount([bot], new Map()), 1)
})
