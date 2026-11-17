import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { createElement, useEffect } from 'react'

const none = () => null
const noop = () => {}

// AgentPanel reports the open chat's heading; `saved` is whether the server has stored it.
let saved = false
let reported: boolean | undefined
let panelProps: Record<string, unknown> = {}

type PanelProps = { sessionId: string; onTitleChange: (...args: unknown[]) => void }
mock.module('../../components/agent/AgentPanel', () => ({
  AgentPanel: (props: PanelProps) => {
    const { sessionId, onTitleChange } = props

    panelProps = props
    useEffect(() => {
      if (reported === saved) return
      reported = saved
      onTitleChange('New Task', sessionId, undefined, true, undefined, true, saved)
    })

    return null
  },
}))
mock.module('../../components/agent/SessionParticipants', () => ({ SessionParticipants: none }))
mock.module('../../components/agent/SessionHeaderMenu', () => ({ SessionHeaderMenu: none }))
mock.module('../../components/agent/summary/ChatSummaryPanel', () => ({ ChatSummaryPanel: none }))
mock.module('../../components/agent/summary/ChatSummaryToggle', () => ({ ChatSummaryToggle: none }))
mock.module('../../components/agent/summary/useSessionInputRequests', () => ({
  // The Task waits on a question of its own.
  useSessionInputRequests: () => ({
    requests: [{ sessionId: 'new-task', inputRequest: { id: 'q1', question: 'Publish now?' } }],
    loaded: true,
    failed: false,
  }),
}))

test('a new Task asks for its resources once stored, and its composer answers no question', async () => {
  const { Window } = await import('happy-dom')
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { WorkspaceAgentPane } = await import('./WorkspaceAgentPane')
  const dom = new Window()
  const requested: string[] = []
  const values = {
    window: Object.assign(dom, {
      api: {
        agentGetSessionResources: async (sessionId: string) => {
          requested.push(sessionId)

          return { resources: [] }
        },
      },
    }),
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    ResizeObserver: class {
      observe = noop
      unobserve = noop
      disconnect = noop
    },
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const original = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const ws = new Proxy(
    { scope: { teamId: 'team-1' }, selectedSessionId: 'new-task', workspaceActions: {} },
    { get: (target, key) => (key in target ? target[key as keyof typeof target] : noop) },
  )
  const render = () =>
    act(() =>
      root.render(
        createElement(WorkspaceAgentPane, {
          ws: ws as never,
          user: { id: 'user-1', name: 'Ada' } as never,
        }),
      ),
    )

  try {
    // The first message is on its way and the backend has not stored the conversation yet.
    await render()
    await render()
    assert.deepEqual(requested, [])

    saved = true
    await render()
    await render()
    assert.deepEqual(requested, ['new-task'])
    // The question's card answers it; what the composer sends is an ordinary message.
    assert.deepEqual(panelProps.openQuestions, [{ id: 'q1', question: 'Publish now?' }])
    assert.equal(panelProps.decisionReplyTo, undefined)
    assert.equal(panelProps.replyTarget, undefined)
  } finally {
    await act(() => root.unmount())
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
