import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { Item } from './types'
import type { AgentConversation } from '../../api'

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
