import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Window } from 'happy-dom'
import { act, createElement, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ChatIcon } from '../channels/channelParts'

import { botChatRows } from './bot-status'
import { BotPinFace } from './BotPinFace'
import { chatSidebarItem } from './chat-item'

import type { Item } from './types'
import type { AgentConversation } from '../../api'

const conversation: AgentConversation = {
  sessionId: 'bot-a',
  title: 'Bot',
  firstMessage: '',
  messageCount: 0,
  createdAt: '2026-11-12T00:00:00Z',
  lastActiveAt: '2026-11-12T00:00:00Z',
  avatar: '05-rembrandt',
}
const item = (picked?: string | null) =>
  chatSidebarItem({
    conversation,
    teamId: 'team-a',
    active: false,
    runtimeState: undefined,
    unread: false,
    picked,
  })

test('Bots never receive task Idle classification, but removing their avatar restores Task classification', () => {
  assert.equal(item().bot, true)
  assert.equal(item().taskState, undefined)
  assert.equal(item(null).bot, undefined)
  assert.equal(item(null).taskState, 'idle')
})
const working = { state: 'active' as const, schemaVersion: 2, phase: 'running' }
const row = (sessionId: string, fields: Partial<AgentConversation> = {}): AgentConversation => ({
  sessionId,
  teamId: 'one-indicator',
  title: sessionId,
  firstMessage: sessionId,
  messageCount: 1,
  createdAt: '2026-11-17T00:00:00Z',
  lastActiveAt: '2026-11-17T00:00:00Z',
  runtimeState: working,
  lastMessage: { text: `${sessionId} own transcript` },
  ...fields,
})

/** The sidebar's rows for `rows`, each with its runtime state published. */
async function rowsOf(rows: AgentConversation[]): Promise<Item[]> {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    location: dom.location,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    Element: dom.Element,
    localStorage: dom.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const original = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { value, configurable: true })
  const { createRoot } = await import('react-dom/client')
  const { useChatItems } = await import('./use-chat-items')
  const { publishRuntimeStates } = await import('../../lib/agentRuntimeStates')
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement)
  let items: Item[] = []

  function Fixture() {
    items = useChatItems({
      agentSessions: rows,
      teamId: 'one-indicator',
      chatShown: false,
      agentSessionId: null,
    })

    return null
  }

  try {
    await act(() =>
      publishRuntimeStates(
        rows.flatMap((r) => (r.runtimeState ? [[r.sessionId, working] as const] : [])),
      ),
    )
    await act(() => root.render(createElement(Fixture)))

    return items
  } finally {
    await act(() => root.unmount())
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

const markup = (node: unknown) => (isValidElement(node) ? renderToStaticMarkup(node) : '')

test('a working Bot shows the same work dots with or without a chat; a Task keeps its spinner', async () => {
  const items = await rowsOf([
    // A Bot with no chat yet is listed by its own session.
    row('solo-bot', { avatar: '05-rembrandt' }),
    row('chatted-bot', { avatar: '05-rembrandt' }),
    row('chat', {
      kind: 'channel',
      runtimeState: undefined,
      faces: [{ id: 'chatted-bot', name: 'chatted-bot', agent: {} }],
      lastMessage: { text: 'The newest post' },
    }),
    row('task'),
    row('kid', { parentSessionId: 'chatted-bot', runtimeState: undefined }),
  ])
  const at = (id: string) => items.find((item) => item.key === `agent-session:${id}`)!

  for (const id of ['solo-bot', 'chat']) {
    const preview = markup(at(id).previewNode)

    assert.ok(preview.includes('t-typing-dot'), `${id} shows the work dots`)
    assert.ok(!preview.includes('own transcript'), `${id} hides the Bot's own transcript`)
    assert.ok(!markup(at(id).trailing).includes('animate-spin'), `${id} has no spinner`)
  }
  assert.ok(markup(at('task').trailing).includes('animate-spin'), 'a Task keeps its spinner')
  // Its own row and its copy under the chat: the Bot's own row adds no third.
  assert.equal(items.filter((item) => item.key === 'agent-session:kid').length, 2)
})

test('a pinned face receives its actual rendering size rather than a larger wrapper', () => {
  const face = createElement(ChatIcon, { sidebar: true, title: 'Bot' })
  const result = BotPinFace({
    item: { key: 'bot-a', label: 'Bot', enabled: true, iconNode: face },
    size: 56,
  })

  assert.ok(isValidElement<{ size: number; sidebar: boolean }>(result))
  assert.equal(result.props.size, 56)
  assert.equal(result.props.sidebar, false)
})

test('Bots show actual sub-agents directly, without a duplicate own Task', () => {
  const chat = { ...item(), key: 'chat', channel: true, bot: false }
  const bot = { conversation, runtimeState: undefined }
  const kid = {
    conversation: { ...conversation, sessionId: 'kid', parentSessionId: conversation.sessionId },
    runtimeState: undefined,
  }
  const rows = botChatRows({
    chat,
    bot,
    kids: [kid],
    faces: [],
    teamId: 'team-a',
    unread: false,
    openId: 'kid',
  })

  assert.equal(
    rows[1]?.active,
    true,
    'a Bot task opened directly still highlights its only sidebar row',
  )
  assert.deepEqual(
    rows.map((row) => [row.key, row.parentKey]),
    [
      ['chat', undefined],
      ['agent-session:kid', 'chat'],
    ],
  )
})

test('a Bot an agent nested is a top-level Bot; a nested Task keeps its parent', () => {
  const nested = (picked?: string | null) =>
    chatSidebarItem({
      conversation: { ...conversation, parentSessionId: 'lead' },
      teamId: 'team-a',
      active: false,
      runtimeState: undefined,
      unread: false,
      picked,
    })

  assert.equal(nested().parentKey, undefined)
  assert.equal(nested(null).parentKey, 'agent-session:lead')
})

test('reading a Bot question clears its dot but keeps the action-needed preview', () => {
  const chat = { ...item(), key: 'chat', channel: true }
  const bot = {
    conversation: {
      ...conversation,
      inputRequests: [
        {
          id: 'q',
          category: 'preference' as const,
          question: 'Which?',
          status: 'open' as const,
          askedAt: '2026-11-12T00:00:00Z',
        },
      ],
    },
    runtimeState: undefined,
  }

  for (const unread of [false, true]) {
    const [row] = botChatRows({
      chat,
      bot,
      kids: [],
      faces: [],
      teamId: 'team-a',
      unread,
      openId: undefined,
    })

    assert.ok(isValidElement<{ dot: string | null }>(row?.trailing))
    assert.equal(row.trailing.props.dot, unread ? 'unread' : null)
    assert.equal(row.dot, unread ? 'unread' : null)
    assert.ok(row?.previewNode)
  }
})

test('finishing Bot work restores the latest chat post, never its older Task preview', () => {
  const chat = {
    ...item(),
    key: 'chat',
    channel: true,
    preview: 'The newest reply posted in this chat',
  }
  const bot = {
    conversation: {
      ...conversation,
      lastMessage: { text: 'An old Task response from yesterday', role: 'assistant' as const },
    },
    runtimeState: { state: 'active' as const, phase: 'running' },
  }
  const make = (state: 'active' | 'idle') =>
    botChatRows({
      chat,
      bot: { ...bot, runtimeState: { ...bot.runtimeState, state } },
      kids: [],
      teamId: 'team-a',
      unread: false,
      openId: 'chat',
    })[0]

  assert.ok(make('active')?.previewNode, 'the indicator takes the preview line while busy')
  const finished = make('idle')

  assert.equal(finished?.previewNode, undefined, 'no work indicator remains after the turn')
  assert.equal(finished?.preview, 'The newest reply posted in this chat')
  assert.notEqual(finished?.preview, bot.conversation.lastMessage.text)
})

test("a busy Bot's chat row never previews the Bot's own transcript, only the chat's posts", () => {
  // The Bot posted twice this turn and is still working. Its own transcript
  // ends with what it last told its owner, which was never posted in the chat.
  const { avatar: _avatar, ...plain } = conversation
  const chat = chatSidebarItem({
    conversation: {
      ...plain,
      sessionId: 'chat',
      kind: 'channel',
      faces: [{ id: 'bot-a', name: 'Bot', agent: {} }],
      lastMessage: { text: 'Second post of the turn' },
    },
    teamId: 'team-a',
    active: false,
    runtimeState: undefined,
    unread: false,
  })
  const bot = {
    conversation: { ...conversation, lastMessage: { text: 'Narration for the owner only' } },
    runtimeState: { state: 'active' as const, phase: 'running' },
  }
  const row = (state: 'active' | 'idle') =>
    botChatRows({
      chat,
      bot: { ...bot, runtimeState: { ...bot.runtimeState, state } },
      kids: [],
      faces: [],
      teamId: 'team-a',
      unread: false,
      openId: undefined,
    })[0]
  const busy = row('active')

  assert.ok(isValidElement(busy?.previewNode))
  const shown = renderToStaticMarkup(busy.previewNode)

  assert.ok(shown.includes('t-typing-dot'), 'a busy row shows the work dots')
  assert.ok(!shown.includes('Narration for the owner only'))
  assert.equal(row('idle')?.preview, 'Second post of the turn')
})
