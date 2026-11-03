import assert from 'node:assert/strict'
import test from 'node:test'

import { pinnedChatFields } from './pinned-chat-row.ts'

import type { Item } from './types'

const live = (extra: Partial<Item>): Item => ({
  key: 'agent-session:a',
  label: 'Agent',
  enabled: true,
  ...extra,
})

test('a pinned chat keeps its live dot', () => {
  assert.equal(pinnedChatFields(live({ dot: 'waiting' })).dot, 'waiting')
})

test('a pinned chat the viewer does not own keeps its owner-only limits', () => {
  const fields = pinnedChatFields(live({ readOnlyChat: true, managedChat: true }))

  assert.equal(fields.readOnlyChat, true)
  assert.equal(fields.managedChat, true)
  assert.equal(pinnedChatFields(live({})).readOnlyChat, undefined)
})

test('a pin whose chat is not listed carries nothing over', () => {
  assert.deepEqual(Object.values(pinnedChatFields(undefined)).filter(Boolean), [])
})
