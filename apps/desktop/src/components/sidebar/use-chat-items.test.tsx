import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { Item } from './types'
import type { AgentConversation } from '../../api'

const at = '2026-11-14T00:00:00Z'
const bot: AgentConversation = {
  sessionId: 'bot-a',
  title: 'Nuphos Marketing',
  firstMessage: '',
  messageCount: 0,
  createdAt: at,
  lastActiveAt: at,
  avatar: '05-rembrandt',
}
// A chat that stored a name of its own, the Bot's old one.
const chat: AgentConversation = {
  ...bot,
  sessionId: 'chat-a',
  kind: 'channel',
  title: 'Nuphos CMO',
  avatar: undefined,
  faces: [{ id: bot.sessionId, name: 'Nuphos CMO', agent: { avatar: bot.avatar } }],
}

test("a Bot's chat is named after the Bot, and keeps its own name while the Bot is not listed", async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    location: dom.location,
    localStorage: dom.localStorage,
    navigator: dom.navigator,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const original = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { value, configurable: true })
  const { createRoot } = await import('react-dom/client')
  const { useChatItems } = await import('./use-chat-items')
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement)
  let rows: Item[] = []

  function Probe({ agentSessions }: { agentSessions: AgentConversation[] }) {
    rows = useChatItems({ agentSessions, teamId: 'team-a', chatShown: false, agentSessionId: null })

    return null
  }
  const label = async (agentSessions: AgentConversation[]) => {
    await act(() => root.render(createElement(Probe, { agentSessions })))

    return rows.find((row) => row.key === 'agent-session:chat-a')?.label
  }

  try {
    assert.equal(await label([chat, bot]), 'Nuphos Marketing')
    assert.equal(await label([chat]), 'Nuphos CMO')
    await act(() => root.unmount())
  } finally {
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
