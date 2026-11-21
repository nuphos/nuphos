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
import type { ReactElement } from 'react'

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

test("a Bot's row shows typing dots exactly while its chat does, else its latest message", async () => {
  const items = await rowsOf([
    // A Bot with no chat yet is listed by its own session, which has no typing dots.
    row('solo-bot', { avatar: '05-rembrandt' }),
    row('typing-bot', { avatar: '05-rembrandt' }),
    row('typing-chat', {
      kind: 'channel',
      runtimeState: undefined,
      faces: [{ id: 'typing-bot', name: 'typing-bot', agent: {} }],
      lastMessage: { text: 'Hidden while the Bot types' },
    }),
    // This Bot rests while its sub-Task works: its chat shows no typing.
    row('resting-bot', { avatar: '05-rembrandt', runtimeState: undefined }),
    row('resting-chat', {
      kind: 'channel',
      runtimeState: undefined,
      faces: [{ id: 'resting-bot', name: 'resting-bot', agent: {} }],
      lastMessage: { text: 'The newest post' },
    }),
    row('task'),
    // Hidden under its Bot's row when that row is folded.
    row('kid', { parentSessionId: 'resting-bot' }),
  ])
  const at = (id: string) => items.find((item) => item.key === `agent-session:${id}`)!
  const looping = (id: string) =>
    isValidElement<{ looping?: boolean }>(at(id).iconNode) && at(id).iconNode.props.looping

  assert.ok(markup(at('typing-chat').previewNode).includes('t-typing-dot'), 'the chat types')
  for (const [id, text] of [
    ['solo-bot', 'solo-bot own transcript'],
    ['resting-chat', 'The newest post'],
  ]) {
    assert.equal(at(id).previewNode, undefined, `${id} shows no typing dots`)
    assert.equal(at(id).preview, text, `${id} previews its latest message`)
  }
  for (const id of ['solo-bot', 'typing-chat', 'resting-chat']) {
    assert.ok(looping(id), `${id}: the working Bot's face moves`)
    assert.ok(!('labelShimmer' in at(id)), `${id} is not greyed out`)
    assert.ok(!markup(at(id).trailing).includes('animate-spin'), `${id} has no spinner`)
  }
  // With no chat, the face that moves is the Bot's own, and its session's turn spins nothing.
  const solo = at('solo-bot').iconNode as ReactElement<{ faces?: { id: string }[] }>

  assert.equal(solo.props.faces?.[0]?.id, 'solo-bot', 'solo-bot: its own face moves')
  // Bots draws a Bot with no chat by its face, so that one moves too.
  const face = at('solo-bot').face as ReactElement<{ looping?: boolean }>

  assert.ok(face.props.looping, 'solo-bot: the face Bots shows moves')
  assert.ok(
    !markup(at('solo-bot').foldedStatus).includes('animate-spin'),
    'solo-bot shows no spinner when folded',
  )
  assert.ok(
    !markup(at('kid').foldedStatus).includes('animate-spin'),
    "a Bot's own sub-agent shows no spinner on it when folded",
  )
  const copies = items.filter((item) => item.parentKey === 'agent-session:resting-chat')

  assert.equal(copies.length, 1)
  assert.ok(
    !markup(copies[0]?.foldedStatus).includes('animate-spin'),
    'a folded Bot shows no spinner for its sub-Task',
  )
  assert.ok(markup(at('task').trailing).includes('animate-spin'), 'a Task keeps its spinner')
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
