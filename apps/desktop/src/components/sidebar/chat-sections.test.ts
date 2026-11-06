import assert from 'node:assert/strict'
import { test } from 'node:test'

import { withChatSections } from './chat-sections.ts'

import type { Item, Section } from './types'

const row = (
  key: string,
  { parentKey, bot }: { parentKey?: string; bot?: boolean } = {},
): Item => ({
  key,
  label: key,
  enabled: true,
  ...(parentKey ? { parentKey } : {}),
  ...(bot ? { bot } : {}),
})
const layout = (sections: Section[]) =>
  Object.fromEntries(
    sections.map((section) => [section.title ?? '', section.items.map((item) => item.key)]),
  )
const build = (chats: Item[]) =>
  layout(
    withChatSections([
      { items: [] },
      { title: 'Channels', items: [] },
      { title: 'Agents', items: chats },
    ]),
  )

test('a conversation with an avatar is a Bot; everything else is a Task', () => {
  assert.deepEqual(build([row('task'), row('helper', { bot: true })]), {
    '': [],
    Channels: [],
    Bots: ['helper'],
    Tasks: ['task'],
  })
})

test('Bots are ordered by name, Tasks keep newest first', () => {
  const chats = [
    row('newest-task'),
    row('zeta', { bot: true }),
    row('older-task'),
    row('alpha', { bot: true }),
  ]

  assert.deepEqual(build(chats), {
    '': [],
    Channels: [],
    Bots: ['alpha', 'zeta'],
    Tasks: ['newest-task', 'older-task'],
  })
})

test('a Bot keeps the Tasks it started, and a Bot thread takes its own along', () => {
  const chats = [
    row('task-of-bot', { parentKey: 'bot' }),
    row('grandchild', { parentKey: 'task-of-bot' }),
    row('bot', { bot: true }),
    row('parent'),
    row('bot-thread', { parentKey: 'parent', bot: true }),
    row('its-task', { parentKey: 'bot-thread' }),
  ]

  assert.deepEqual(build(chats), {
    '': [],
    Channels: [],
    Bots: ['bot', 'bot-thread', 'task-of-bot', 'grandchild', 'its-task'],
    Tasks: ['parent'],
  })
})

test('a Bot drops its linked-work line; a Task keeps it', () => {
  const sections = withChatSections([
    {
      title: 'Agents',
      items: [
        { ...row('bot', { bot: true }), description: 'PR' },
        { ...row('task'), description: 'PR' },
      ],
    },
  ])

  assert.deepEqual(
    sections.map((section) => section.items.map((item) => item.description)),
    [[undefined], ['PR']],
  )
})

test('a parent cycle does not loop', () => {
  assert.deepEqual(build([row('a', { parentKey: 'b' }), row('b', { parentKey: 'a' })]), {
    '': [],
    Channels: [],
    Bots: [],
    Tasks: ['a', 'b'],
  })
})

test('Bots shows even with no agents at all, so its "+" can make the first', () => {
  // With no agents there is no Agents section to split.
  assert.deepEqual(layout(withChatSections([{ items: [] }, { title: 'Channels', items: [] }])), {
    '': [],
    Channels: [],
    Bots: [],
  })
})
