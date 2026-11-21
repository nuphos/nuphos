import assert from 'node:assert/strict'
import test from 'node:test'

import { inboxQuestions, shownQuestions } from './inboxItems.ts'

import type { AgentConversation } from '../../api/agent-types.ts'

// Each dismissal sent: [sessionId, requestId, teamId, resolution, reason].
const dismissals: unknown[][] = []
// The questions the server refuses to dismiss, as when one was answered meanwhile in its chat.
const refused = new Set<string>()

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    addEventListener: () => {},
    removeEventListener: () => {},
    api: {
      onAgentEvent: () => () => {},
      agentResolveDecision: async (...args: unknown[]) => {
        dismissals.push(args)
        if (refused.has(String(args[1]))) throw new Error('This question is no longer open')

        return { ok: true, resolved: true }
      },
      agentAnswerDecision: async () => ({ ok: true }),
    },
  },
})

const inbox = await import('./useInbox.ts')
const { dismissQuestions } = await import('./dismissAll.ts')
const { inboxSearch, shareInboxSearch } = await import('./inboxSelection.ts')

const settle = () => new Promise((resolve) => setImmediate(resolve))
const later = new Date(Date.now() + 3_600_000).toISOString()
const ask = (id: string, question: string, snoozedUntil?: string) => ({
  id,
  category: 'preference' as const,
  question,
  askedAt: `2026-11-18T00:00:00Z ${id}`,
  status: 'open' as const,
  snoozedUntil,
})
const listing = [
  {
    sessionId: 'release',
    title: 'Release notes',
    isOwner: true,
    inputRequests: [ask('a1', 'Ship on Friday?'), ask('a2', 'Which changelog?', later)],
  },
  { sessionId: 'billing', title: 'Billing', isOwner: true, inputRequests: [ask('b1', 'Retry?')] },
  { sessionId: 'shared', title: 'Shared', isOwner: false, inputRequests: [ask('c1', 'Mine?')] },
] as AgentConversation[]
// What the Inbox shows: its rows as listed now, for a search.
const shown = (query = '') =>
  shownQuestions(inboxQuestions(listing, inbox.answeredOnDevice()), query)
const ids = (rows: { request: { id: string } }[]) => rows.map((row) => row.request.id).sort()

test('"Dismiss all" clears the questions shown: not snoozed ones, nor ones outside a search', () => {
  assert.deepEqual(ids(shown()), ['a1', 'b1'], 'a snoozed or shared question is not shown')
  assert.deepEqual(ids(shown('retry')), ['b1'])
  assert.deepEqual(ids(shown('release')), ['a1'], "a conversation's title finds its questions")
})

test("the sidebar lists the Inbox page search's matches, and all of them once it is gone", () => {
  shareInboxSearch('team', 'retry')
  assert.deepEqual(ids(shown(inboxSearch('team'))), ['b1'], '"Dismiss all" there takes only b1')
  assert.equal(inboxSearch('other'), '', "another team's list is not narrowed")
  shareInboxSearch('team', '')
  assert.deepEqual(ids(shown(inboxSearch('team'))), ['a1', 'b1'])
})

test('they all leave at once, and each is dismissed on its own at once', async () => {
  const results: unknown[] = []

  dismissQuestions('team', shown(), (result) => results.push(result))
  assert.deepEqual(shown(), [], 'gone at once')
  assert.deepEqual(
    dismissals.map(([sessionId, id, team, resolution]) => [sessionId, id, team, resolution]),
    [
      ['billing', 'b1', 'team', 'dismissed'],
      ['release', 'a1', 'team', 'dismissed'],
    ],
    'sent at once, with no Undo window',
  )
  await settle()
  await settle()
  assert.deepEqual(results, [{ failed: [], reason: undefined }])
  assert.deepEqual(shown(), [], 'and they stay gone')
  dismissals.length = 0
})

test('the questions refused stay in the list, and the result says which and why', async () => {
  const rows = [
    { conversation: listing[1], request: ask('r1', 'One') },
    { conversation: listing[1], request: ask('r2', 'Two') },
    { conversation: listing[1], request: ask('r3', 'Three') },
  ]
  const own = { ...listing[1], inputRequests: rows.map((row) => row.request) } as AgentConversation
  const left = () => ids(inboxQuestions([own], inbox.answeredOnDevice()))
  const results: { failed: { request: { id: string } }[]; reason?: string }[] = []

  refused.add('r2')
  dismissQuestions('team', rows, (result) => results.push(result))
  assert.deepEqual(left(), [])
  await settle()
  await settle()
  assert.deepEqual(left(), ['r2'], 'only the refused one is back')
  assert.deepEqual(ids(results[0].failed), ['r2'])
  assert.equal(results[0].reason, 'This question is no longer open')
  refused.clear()
  dismissals.length = 0
})
