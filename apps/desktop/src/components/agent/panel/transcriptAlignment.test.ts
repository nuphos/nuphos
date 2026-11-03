import assert from 'node:assert/strict'
import test from 'node:test'

import { applyTranscriptTail, isShownMessage, startUserTurn } from './turnBoundaries.ts'

import type { Message, Tab } from './model.ts'

const text = (id: string, role: Message['role'], value: string): Message => ({
  id,
  role,
  parts: [{ type: 'text', text: value }],
})

const tabWith = (messages: Message[]): Tab =>
  ({
    id: 'tab',
    sessionId: 'session',
    title: 'Chat',
    messages,
    streaming: true,
    connected: true,
    streamId: 'stream',
    streamStartedAt: null,
    error: null,
    autoResumeAttempts: 0,
    historyBaseIndex: 0,
    readOnly: false,
  }) as unknown as Tab

const userIds = (tab: Tab) =>
  tab.messages.filter((message) => message.role === 'user').map((message) => message.id)

const sent = text('u3', 'user', 'Fix the rescheduling')

// The run is replayed from frame 0 on every reconnect: turn start, then the
// stored tail, which starts at the prompt's conversation index (3).
function replay(tab: Tab, times: number): Tab {
  let next = tab

  for (let i = 0; i < times; i++) {
    next = startUserTurn(next, 'stream', [sent])
    next = applyTranscriptTail(next, 'stream', [sent], 3)
  }

  return next
}

test('a stored message with nothing to show keeps its index, so the tail replaces the sent copy', () => {
  // Index 2 has no part the client shows (an empty row, an unknown tool type).
  // Loaded history keeps it, as fromPersistedMessages does.
  const loaded = [
    text('u0', 'user', 'Check the videos'),
    text('a1', 'assistant', 'Checked'),
    { id: 'a2', role: 'assistant', parts: [] } satisfies Message,
  ]

  assert.deepEqual(userIds(replay(tabWith([...loaded, sent]), 3)), ['u0', 'u3'])
})

test('history missing a stored message repeats the prompt: why loading must not drop one', () => {
  const dropped = [text('u0', 'user', 'Check the videos'), text('a1', 'assistant', 'Checked')]

  assert.deepEqual(userIds(replay(tabWith([...dropped, sent]), 1)), ['u0', 'u3', 'u3'])
})

test('only messages with something to draw are shown, and count as the last message', () => {
  const messages: Message[] = [
    text('a1', 'assistant', 'Checked'),
    { id: 'a2', role: 'assistant', parts: [] },
  ]

  assert.equal(messages.findLast(isShownMessage)?.id, 'a1')
  assert.equal(
    isShownMessage({ id: 'a3', role: 'assistant', parts: [], turnOrigin: 'autonomous' }),
    true,
  )
})
