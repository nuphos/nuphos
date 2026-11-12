import assert from 'node:assert/strict'
import { test } from 'node:test'

import { foldKey, withChatSections } from './chat-sections.ts'
import { nestItems } from './nest-items.ts'
import { taskPageSections } from './task-page-sections.ts'

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

test('a Bot with its chat is listed as that chat; its Tasks are under it in Tasks', () => {
  const agents = [
    row('agent-session:dm', { channel: true, botChannelOf: 'ada' }),
    row('agent-session:ada', { bot: true }),
    row('task-of-ada', { parentKey: 'agent-session:ada' }),
    row('agent-session:new', { bot: true }),
  ]

  assert.deepEqual(build(agents), {
    '': [],
    Channels: ['agent-session:dm', 'agent-session:new'],
    Tasks: ['agent-session:ada', 'task-of-ada'],
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

test('delegated Tasks nest under their Bot in Tasks', () => {
  const sections = withChatSections([
    {
      title: 'Agents',
      items: [
        row('agent-session:bot', { bot: true }),
        row('child', { parentKey: 'agent-session:bot' }),
      ],
    },
  ])
  const tasks = sections.find((section) => section.title === 'Tasks')

  assert.ok(tasks)
  assert.deepEqual(
    nestItems(tasks.items).map(({ item, depth }) => [item.key, depth]),
    [
      ['agent-session:bot', 0],
      ['child', 1],
    ],
  )
  // The Bot's own Task, listed as a Task, so the Tasks page keeps it.
  assert.equal(tasks.items[0]?.bot, undefined)
  assert.deepEqual(
    taskPageSections(tasks.items).flatMap((section) => section.items.map((item) => item.key)),
    ['agent-session:bot', 'child'],
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
