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
const build = (chats: Item[], pinned: string[]) =>
  layout(
    withChatSections(
      [{ items: [] }, { title: 'Agents', items: chats }],
      chats.filter((item) => pinned.includes(item.key)),
      (item) => pinned.includes(item.key),
    ),
  )

test('a pinned conversation takes its threads to Pinned', () => {
  const chats = [row('thread', 'parent'), row('grandchild', 'thread'), row('parent'), row('other')]

  assert.deepEqual(build(chats, ['parent']), {
    '': [],
    Pinned: ['parent', 'thread', 'grandchild'],
    Agents: ['other'],
  })
})

test('a pinned thread leaves its parent and takes its own threads along', () => {
  const chats = [
    row('parent'),
    row('thread', 'parent'),
    row('grandchild', 'thread'),
    row('sibling', 'parent'),
  ]

  assert.deepEqual(build(chats, ['thread']), {
    '': [],
    Pinned: ['thread', 'grandchild'],
    Agents: ['parent', 'sibling'],
  })
})

test('a parent cycle does not loop', () => {
  assert.deepEqual(build([row('a', 'b'), row('b', 'a')], []), { '': [], Agents: ['a', 'b'] })
})

test('a pinned chat that left the chat list, like an archived one, leaves Pinned', () => {
  const pinned = ['archived', 'kept']
  const sidebar = (chats: Item[]) =>
    layout(
      withChatSections(
        [{ items: [] }, { title: 'Agents', items: chats }],
        pinned.map((key) => row(key)),
        (item) => pinned.includes(item.key),
      ),
    )

  assert.deepEqual(sidebar([row('kept'), row('other')]), {
    '': [],
    Pinned: ['kept'],
    Agents: ['other'],
  })
  // Restored, it lists again and is back in Pinned.
  assert.deepEqual(sidebar([row('archived'), row('kept'), row('other')]), {
    '': [],
    Pinned: ['archived', 'kept'],
    Agents: ['other'],
  })
})
