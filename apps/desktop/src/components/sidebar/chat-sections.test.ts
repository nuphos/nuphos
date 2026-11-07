import assert from 'node:assert/strict'
import { test } from 'node:test'

import { withChatSections } from './chat-sections.ts'

import type { Item, Section } from './types'

const row = (
  key: string,
  {
    parentKey,
    bot,
    channel,
    botChannelOf,
    readOnlyChat,
  }: {
    parentKey?: string
    bot?: boolean
    channel?: boolean
    botChannelOf?: string
    readOnlyChat?: boolean
  } = {},
): Item => ({
  key,
  label: key,
  enabled: true,
  ...(parentKey ? { parentKey } : {}),
  ...(bot ? { bot } : {}),
  ...(channel ? { channel } : {}),
  ...(botChannelOf ? { botChannelOf } : {}),
  ...(readOnlyChat ? { readOnlyChat } : {}),
})
const layout = (sections: Section[]) =>
  Object.fromEntries(
    sections.map((section) => [section.title ?? '', section.items.map((item) => item.key)]),
  )
const build = (agents: Item[]) =>
  layout(withChatSections([{ items: [] }, { title: 'Agents', items: agents }]))

test('Bots holds group chats and Bots in the list order; Tasks holds every session', () => {
  const agents = [
    row('newest-task'),
    row('zeta', { bot: true }),
    row('group', { channel: true }),
    row('older-task'),
    row('alpha', { bot: true }),
  ]

  assert.deepEqual(build(agents), {
    '': [],
    Channels: ['zeta', 'group', 'alpha'],
    Tasks: ['newest-task', 'zeta', 'older-task', 'alpha'],
  })
})

test('a Bot with its chat is listed as that chat; its Tasks are under Tasks', () => {
  const agents = [
    row('agent-session:dm', { channel: true, botChannelOf: 'ada' }),
    row('agent-session:ada', { bot: true }),
    row('task-of-ada', { parentKey: 'agent-session:ada' }),
    row('agent-session:new', { bot: true }),
  ]

  assert.deepEqual(build(agents), {
    '': [],
    Channels: ['agent-session:dm', 'agent-session:new'],
    Tasks: ['agent-session:ada', 'task-of-ada', 'agent-session:new'],
  })
})

test("a teammate's Bot without a chat stays a Task: only its owner can bring it into one", () => {
  const agents = [
    row('agent-session:mine', { bot: true }),
    row('agent-session:theirs', { bot: true, readOnlyChat: true }),
  ]

  assert.deepEqual(build(agents), {
    '': [],
    Channels: ['agent-session:mine'],
    Tasks: ['agent-session:mine', 'agent-session:theirs'],
  })
})

test('opening a Bot without its chat makes the chat', () => {
  const opened: string[] = []
  const [, chats] = withChatSections(
    [{ items: [] }, { title: 'Agents', items: [row('agent-session:new', { bot: true })] }],
    (botId) => opened.push(botId),
  )

  chats?.items[0]?.onActivate?.(false)
  assert.deepEqual(opened, ['new'])
})

test('a chat drops its linked-work line; a Task keeps it', () => {
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
    [[undefined], ['PR', 'PR']],
  )
})

test('a parent cycle does not loop', () => {
  assert.deepEqual(build([row('a', { parentKey: 'b' }), row('b', { parentKey: 'a' })]), {
    '': [],
    Channels: [],
    Tasks: ['a', 'b'],
  })
})

test('Chats shows even with no agents at all, so its "+" can make the first', () => {
  assert.deepEqual(build([]), { '': [], Channels: [] })
})
