import assert from 'node:assert/strict'
import { test } from 'node:test'

import { withChatSections } from './chat-sections.ts'

import type { Item, Section } from './types'

const row = (key: string, parentKey?: string): Item => ({
  key,
  label: key,
  enabled: true,
  ...(parentKey ? { parentKey } : {}),
})
const layout = (sections: Section[]) =>
  Object.fromEntries(
    sections.map((section) => [section.title ?? '', section.items.map((item) => item.key)]),
  )
const build = (chats: Item[], shared: Item[], pinned: string[]) =>
  layout(
    withChatSections(
      [{ items: [] }, { title: 'Chats', items: chats }],
      [...chats, ...shared].filter((item) => pinned.includes(item.key)),
      shared,
      (item) => pinned.includes(item.key),
    ),
  )

test('a pinned conversation takes its threads to Pinned', () => {
  const chats = [row('thread', 'parent'), row('grandchild', 'thread'), row('parent'), row('other')]

  assert.deepEqual(build(chats, [], ['parent']), {
    '': [],
    Pinned: ['parent', 'thread', 'grandchild'],
    Chats: ['other'],
  })
})

test('a shared conversation keeps its threads, even ones listed in Chats', () => {
  const chats = [row('mine', 'theirs'), row('other')]
  const shared = [row('theirs'), row('their-thread', 'theirs')]

  assert.deepEqual(build(chats, shared, []), {
    '': [],
    Shared: ['theirs', 'their-thread', 'mine'],
    Chats: ['other'],
  })
})

test('a pinned thread leaves its parent and takes its own threads along', () => {
  const chats = [
    row('parent'),
    row('thread', 'parent'),
    row('grandchild', 'thread'),
    row('sibling', 'parent'),
  ]

  assert.deepEqual(build(chats, [], ['thread']), {
    '': [],
    Pinned: ['thread', 'grandchild'],
    Chats: ['parent', 'sibling'],
  })
})

test('a pinned shared conversation is listed once, under Pinned', () => {
  assert.deepEqual(build([], [row('theirs')], ['theirs']), { '': [], Pinned: ['theirs'] })
})

test('a parent cycle does not loop', () => {
  assert.deepEqual(build([row('a', 'b'), row('b', 'a')], [], []), { '': [], Chats: ['a', 'b'] })
})
