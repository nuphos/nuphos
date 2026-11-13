import assert from 'node:assert/strict'
import { test } from 'node:test'

import { foldKey, unpinnedChatItems, withChatSections } from './chat-sections.ts'
import { nestItems } from './nest-items.ts'

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

test('Bots holds group chats and Bots in the list order; Tasks holds only ordinary sessions', () => {
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
    Tasks: ['newest-task', 'older-task'],
  })
})

test('a Bot and its tasks stay under its chat, outside Tasks', () => {
  const agents = [
    row('agent-session:dm', { channel: true, botChannelOf: 'ada' }),
    row('agent-session:ada', { bot: true }),
    row('task-of-ada', { parentKey: 'agent-session:ada' }),
    row('agent-session:new', { bot: true }),
  ]

  assert.deepEqual(build(agents), {
    '': [],
    Channels: ['agent-session:dm', 'task-of-ada', 'agent-session:new'],
  })
})

test("a teammate's Bot without a chat keeps a Bots entry without creating a chat", () => {
  const agents = [
    row('agent-session:mine', { bot: true }),
    row('agent-session:theirs', { bot: true, readOnlyChat: true }),
  ]

  assert.deepEqual(build(agents), {
    '': [],
    Channels: ['agent-session:mine', 'agent-session:theirs'],
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
    [[undefined], ['PR']],
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

test('inviting a human into a Bot chat does not expose the fallback Bot row', () => {
  const group = { ...row('group', { channel: true }), channelAgentIds: ['ada'] }

  assert.deepEqual(build([group, row('agent-session:ada', { bot: true })]), {
    '': [],
    Channels: ['group'],
  })
})

test('a group with several agents suppresses each fallback without hiding other Bots', () => {
  const group = { ...row('group', { channel: true }), channelAgentIds: ['ada', 'venus'] }

  assert.deepEqual(
    build([
      group,
      row('agent-session:ada', { bot: true }),
      row('agent-session:venus', { bot: true }),
      row('agent-session:new', { bot: true }),
    ]),
    {
      '': [],
      Channels: ['group', 'agent-session:new'],
    },
  )
})

test('project grouping receives ordinary Tasks only', () => {
  const received: Item[][] = []

  withChatSections(
    [{ title: 'Agents', items: [row('bot', { bot: true }), row('task')] }],
    undefined,
    (tasks) => {
      received.push(tasks)

      return tasks
    },
  )
  assert.deepEqual(
    received[0]?.map((item) => item.key),
    ['task'],
  )
})

test('a read-only Bot fallback does not try to create a chat', () => {
  const sections = withChatSections(
    [{ title: 'Agents', items: [row('bot', { bot: true, readOnlyChat: true })] }],
    () => assert.fail('only the owner can create the chat'),
  )

  assert.equal(sections[0]?.items[0]?.onActivate, undefined)
})

test('delegated Tasks stay nested with their Bot instead of becoming Task roots', () => {
  const sections = withChatSections([
    {
      title: 'Agents',
      items: [
        row('agent-session:bot', { bot: true }),
        row('child', { parentKey: 'agent-session:bot' }),
      ],
    },
  ])

  assert.equal(
    sections.some((section) => section.title === 'Tasks'),
    false,
  )
  assert.deepEqual(
    nestItems(sections[0]!.items).map(({ item, depth }) => [item.key, depth]),
    [
      ['agent-session:bot', 0],
      ['child', 1],
    ],
  )
})

test('Bot-nested task copies stay under Bots without duplicating ordinary Tasks', () => {
  const sections = withChatSections([
    {
      title: 'Agents',
      items: [
        row('bot', { bot: true }),
        row('child'),
        { ...row('nested-child', { parentKey: 'bot' }), botNested: true },
      ],
    },
  ])

  assert.deepEqual(layout(sections), { Channels: ['bot', 'nested-child'], Tasks: ['child'] })
  assert.equal(foldKey({ title: 'Channels' }, 'child'), 'bots:child')
  assert.equal(foldKey({ title: 'Tasks' }, 'child'), 'child')
})

test('Bot descendants retain their hierarchy and are excluded from project Tasks', () => {
  const rows = [
    row('agent-session:dm', { channel: true, botChannelOf: 'ada' }),
    row('agent-session:ada', { bot: true }),
    row('child', { parentKey: 'agent-session:ada' }),
    row('grandchild', { parentKey: 'child' }),
    row('task'),
    row('task-child', { parentKey: 'task' }),
  ]
  const received: Item[][] = []
  const sections = withChatSections([{ title: 'Agents', items: rows }], undefined, (items) => {
    received.push(items)

    return items
  })

  assert.deepEqual(
    received[0]?.map((item) => item.key),
    ['task', 'task-child'],
  )
  assert.deepEqual(
    nestItems(sections[0]!.items).map(({ item, depth }) => [item.key, depth]),
    [
      ['agent-session:dm', 0],
      ['child', 1],
      ['grandchild', 2],
    ],
  )
})

test('a fallback Bot keeps its children and existing chat copies are not duplicated', () => {
  const fallback = withChatSections([
    { title: 'Agents', items: [row('bot', { bot: true }), row('child', { parentKey: 'bot' })] },
  ])

  assert.deepEqual(
    nestItems(fallback[0]!.items).map(({ depth }) => depth),
    [0, 1],
  )
  const copy = { ...row('child', { parentKey: 'dm' }), botNested: true }

  assert.deepEqual(
    build([
      row('dm', { channel: true, botChannelOf: 'ada' }),
      row('agent-session:ada', { bot: true }),
      row('child', { parentKey: 'agent-session:ada' }),
      copy,
    ]).Channels,
    ['dm', 'child'],
  )
})

test('pinning a Bot hides its entire delegated tree without orphaning grandchildren', () => {
  const items = [
    row('bot', { bot: true }),
    row('child', { parentKey: 'bot' }),
    row('grandchild', { parentKey: 'child' }),
    row('other'),
  ]

  assert.deepEqual(
    unpinnedChatItems(items, (item) => item.key === 'bot').map((item) => item.key),
    ['other'],
  )
  assert.deepEqual(
    unpinnedChatItems(items, (item) => item.key === 'child').map((item) => item.key),
    ['bot', 'other'],
  )
})

test('pin filtering tolerates missing parents and parent cycles', () => {
  const items = [
    row('a', { parentKey: 'b' }),
    row('b', { parentKey: 'a' }),
    row('orphan', { parentKey: 'missing' }),
  ]

  assert.deepEqual(
    unpinnedChatItems(items, () => false),
    items,
  )
  assert.deepEqual(
    unpinnedChatItems(items, (item) => item.key === 'a').map((item) => item.key),
    ['orphan'],
  )
})
