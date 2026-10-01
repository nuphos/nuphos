import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { resolveSessionSync } from './agentSessionSync.ts'

import type { SessionSyncInput } from './agentSessionSync.ts'

// Run with: bun run test  (node --experimental-strip-types --test)
//
// The bug this exists for: opening a chat from the Chats page and pressing Back
// landed on Agent Home instead of the list. Nothing in the workspace's history
// code was wrong — the panel *told* it to go Home. An open is async, so between
// "show conversation X" and "X is loaded" the panel holds no tab; any re-render
// in that window (a history refresh alone re-created `openConversation` and
// re-ran the effect) read as "the user closed the chat" and published null.

const base: SessionSyncInput = {
  prop: 'sess-1',
  internal: null,
  lastSynced: undefined,
  opening: null,
  pendingImport: null,
  hasLoadedTabForProp: false,
}

const resolve = (over: Partial<SessionSyncInput> = {}) => resolveSessionSync({ ...base, ...over })

test('a fresh mount pointed at a conversation opens it', () => {
  assert.deepEqual(resolve(), { kind: 'open', sessionId: 'sess-1' })
})

test('a re-render mid-open must not report the chat as closed', () => {
  // Exactly the state after the open started: we synced the prop, the fetch is
  // in flight, and the panel still shows nothing.
  const action = resolve({ lastSynced: 'sess-1', opening: 'sess-1', internal: null })

  assert.deepEqual(action, { kind: 'awaiting-open' })
})

test('once the conversation lands both sides agree', () => {
  const action = resolve({ lastSynced: 'sess-1', opening: null, internal: 'sess-1' })

  assert.deepEqual(action, { kind: 'adopt' })
})

test('the panel closing a chat is still published', () => {
  const action = resolve({ lastSynced: 'sess-1', opening: null, internal: null })

  assert.deepEqual(action, { kind: 'publish', sessionId: null })
})

test('the panel switching chats is still published', () => {
  const action = resolve({ lastSynced: 'sess-1', opening: null, internal: 'sess-2' })

  assert.deepEqual(action, { kind: 'publish', sessionId: 'sess-2' })
})

test('an open for a different conversation does not suppress a publish', () => {
  // The user closed chat 1 while chat 2 was loading: the close is real news.
  const action = resolve({ lastSynced: 'sess-1', opening: 'sess-2', internal: null })

  assert.deepEqual(action, { kind: 'publish', sessionId: null })
})

// Dismissing a chat while it is still loading: prop goes null before the fetch
// lands, and internal is still null, so "both null" looks like agreement.
// Adopting there strands the fetch — when it resolves the panel is holding the
// dismissed conversation, and publishes it straight back.
test('dismissing while a chat is opening cancels rather than settling', () => {
  const action = resolve({ prop: null, internal: null, lastSynced: 'sess-1', opening: 'sess-1' })

  assert.deepEqual(action, { kind: 'clear' })
})

test('the workspace clearing the session sends the panel home', () => {
  const action = resolve({ prop: null, lastSynced: 'sess-1', internal: 'sess-1' })

  assert.deepEqual(action, { kind: 'clear' })
})

test('an already-loaded conversation is activated, not refetched', () => {
  const action = resolve({ lastSynced: 'sess-9', internal: 'sess-9', hasLoadedTabForProp: true })

  assert.deepEqual(action, { kind: 'activate', sessionId: 'sess-1' })
})

test('a pending import owns the transition', () => {
  const action = resolve({ pendingImport: 'sess-1', internal: null })

  assert.deepEqual(action, { kind: 'defer-to-import' })
})

test('an uncontrolled panel is left alone', () => {
  assert.deepEqual(resolve({ prop: undefined }), { kind: 'ignore' })
})

// The decision above is only as good as what the panel feeds it. The first
// attempt at this fix passed `openingConversation` — React state, which lands a
// render *after* the open starts — so in that gap the panel still reported the
// chat as closed and Back still went to Agent Home. The in-flight open must be
// read from the ref that is set synchronously.
test('the panel reports in-flight opens from the synchronous ref', () => {
  const src = readFileSync(
    join(import.meta.dirname, '..', 'components', 'agent', 'panel', 'usePanelSessionBridge.ts'),
    'utf8',
  )
  const call = /resolveSessionSync\(\{([\s\S]*?)\n[ \t]*\}\)/.exec(src)

  assert.ok(call, 'AgentPanel must reconcile through resolveSessionSync')
  const opening = /\n[ \t]*opening:[ \t]*([^\n]*)/.exec(call[1])

  assert.ok(opening, 'the call must pass `opening`')
  assert.match(
    opening[1],
    /pendingOpenRef\.current/,
    '`opening` must come from pendingOpenRef (synchronous), not from state that lands a render later',
  )
})

// The full sequence of a chat opened from a list, asserting the panel never
// publishes anything the workspace would record as leaving the chat.
test('opening from a list publishes nothing until the panel has moved', () => {
  const published: (string | null)[] = []
  let lastSynced: string | null | undefined = undefined
  let internal: string | null = null
  let opening: string | null = null

  const step = (prop: string | null) => {
    const action = resolveSessionSync({
      prop,
      internal,
      lastSynced,
      opening,
      pendingImport: null,
      hasLoadedTabForProp: internal === prop && internal !== null,
    })

    if (action.kind === 'publish') {
      lastSynced = action.sessionId
      published.push(action.sessionId)
    } else if (action.kind === 'open') {
      lastSynced = prop
      opening = action.sessionId
    } else if (action.kind !== 'awaiting-open') {
      lastSynced = prop
    }

    return action.kind
  }

  assert.equal(step('sess-1'), 'open')
  // Re-renders while the fetch is in flight — a history refresh, a credential
  // reload — each of which used to publish null.
  assert.equal(step('sess-1'), 'awaiting-open')
  assert.equal(step('sess-1'), 'awaiting-open')
  // The fetch lands.
  internal = 'sess-1'
  opening = null
  assert.equal(step('sess-1'), 'adopt')

  assert.deepEqual(published, [], 'the panel must not publish while opening')
})
