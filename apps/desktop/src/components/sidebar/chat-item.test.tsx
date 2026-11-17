import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createElement, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ChatIcon } from '../channels/channelParts'

import { botChatRows } from './bot-status'
import { BotPinFace } from './BotPinFace'
import { chatSidebarItem } from './chat-item'

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

test("a Bot row's one dot is its own unread; a Task under a Bot is never unread", async () => {
  const { Window } = await import('happy-dom')
  const { act } = await import('react')
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
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
  const { receiveConversationReadStates } = await import('../../lib/agentUnreadSessions')
  const { FoldedStatus } = await import('./folded-status')
  const { avatar: _avatar, ...plain } = conversation
  const chatOf = (sessionId: string, bot: string): AgentConversation => ({
    ...plain,
    sessionId,
    kind: 'channel',
    faces: [{ id: bot, name: bot, agent: {} }],
  })
  const sessions: AgentConversation[] = [
    // quiet-bot's sub-Task got a new reply; loud-bot's own chat did.
    { ...conversation, sessionId: 'quiet-bot' },
    chatOf('quiet-chat', 'quiet-bot'),
    { ...plain, sessionId: 'quiet-kid', parentSessionId: 'quiet-bot' },
    { ...conversation, sessionId: 'loud-bot' },
    chatOf('loud-chat', 'loud-bot'),
    { ...plain, sessionId: 'loud-kid', parentSessionId: 'loud-bot' },
    // A Task an ordinary Task started keeps its unread.
    { ...plain, sessionId: 'lead' },
    { ...plain, sessionId: 'lead-kid', parentSessionId: 'lead' },
  ]
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement)
  let items: ReturnType<typeof useChatItems> = []

  function Fixture() {
    items = useChatItems({
      agentSessions: sessions,
      teamId: 'team-a',
      chatShown: false,
      agentSessionId: null,
    })

    return null
  }

  try {
    receiveConversationReadStates(
      ['quiet-kid', 'loud-chat', 'loud-kid', 'lead-kid'].map((sessionId) => ({
        sessionId,
        activitySeq: 1,
        readSeq: 0,
      })),
    )
    await act(() => root.render(createElement(Fixture)))
  } finally {
    await act(() => root.unmount())
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
  // Each Bot's chat row, as the sidebar draws it with its sub-Tasks folded.
  const dots = (chat: string) => {
    const at = items.findIndex((row) => row.key === chat)
    const hidden = items.filter((row) => row.parentKey === chat)
    const trailing = createElement(
      'span',
      null,
      items[at]?.trailing,
      createElement(FoldedStatus, { rows: hidden }),
    )

    return renderToStaticMarkup(trailing).split('bg-action-primary').length - 1
  }

  assert.equal(dots('agent-session:quiet-chat'), 0, "a sub-Task's reply puts no dot on its Bot")
  assert.equal(dots('agent-session:loud-chat'), 1, "a Bot's own unread message is exactly one dot")
  for (const kid of ['quiet-kid', 'loud-kid'])
    assert.ok(
      items
        .filter((row) => row.key === `agent-session:${kid}`)
        .every((row) => !row.unread && row.dot !== 'unread'),
      `${kid} under a Bot carries no unread, nested or on Tasks`,
    )
  assert.equal(items.find((row) => row.key === 'agent-session:lead-kid')?.unread, true)
})
