import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { AgentConversation } from '../../api'

const conversation = (
  id: string,
  seconds: number,
  activitySeq = 1,
  readSeq = 1,
): AgentConversation => ({
  sessionId: id,
  teamId: 'atomic-task-order',
  title: id,
  firstMessage: id,
  messageCount: 1,
  createdAt: '2026-11-13T00:00:00Z',
  lastActiveAt: `2026-11-13T00:00:${String(seconds).padStart(2, '0')}Z`,
  activitySeq,
  readSeq,
})

async function withOrdering(
  run: (fixture: {
    receive: (rows: AgentConversation[]) => Promise<void>
    render: (rows: AgentConversation[]) => Promise<void>
    order: () => string[]
  }) => Promise<void>,
) {
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
  const { taskPageSections } = await import('./task-page-sections')
  const { receiveConversationReadStates } = await import('../../lib/agentUnreadSessions')
  const { publishRuntimeStates } = await import('../../lib/agentRuntimeStates')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  let order: string[] = []

  function Fixture({ rows }: { rows: AgentConversation[] }) {
    const items = useChatItems({
      agentSessions: rows,
      teamId: 'atomic-task-order',
      chatShown: true,
      agentSessionId: null,
    })

    order = taskPageSections(items.map((item) => ({ ...item, task: true })))[0].items.map((item) =>
      item.key.replace('agent-session:', ''),
    )

    return createElement('div', null, order.join(','))
  }
  const render = async (rows: AgentConversation[]) => {
    await act(() => root.render(createElement(Fixture, { rows })))
  }

  try {
    await run({
      receive: async (rows) => {
        await act(() => {
          publishRuntimeStates(
            rows.flatMap((row) =>
              row.runtimeState ? [[row.sessionId, row.runtimeState] as const] : [],
            ),
          )
          receiveConversationReadStates(rows)
        })
      },
      render,
      order: () => [...order],
    })
  } finally {
    await act(() => root.unmount())
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

test('sequential completions use each response timestamp before the paginated list commits', async () => {
  await withOrdering(async ({ receive, render, order }) => {
    const a = {
      ...conversation('completion-a', 1),
      runtimeState: {
        state: 'active' as const,
        schemaVersion: 2,
        epoch: 'completion-runtime',
        revision: 1,
      },
    }
    const b = {
      ...conversation('completion-b', 2),
      runtimeState: {
        state: 'active' as const,
        schemaVersion: 2,
        epoch: 'completion-runtime',
        revision: 1,
      },
    }
    const aDone = {
      ...conversation(a.sessionId, 10, 2, 1),
      runtimeState: {
        state: 'idle' as const,
        schemaVersion: 2,
        epoch: 'completion-runtime',
        revision: 2,
      },
    }
    const bDone = {
      ...conversation(b.sessionId, 20, 2, 1),
      runtimeState: {
        state: 'idle' as const,
        schemaVersion: 2,
        epoch: 'completion-runtime',
        revision: 2,
      },
    }

    await receive([a, b])
    await render([a, b])
    await receive([aDone])
    assert.equal(order()[0], a.sessionId)
    await render([aDone, b])
    await receive([bDone])
    assert.equal(
      order()[0],
      b.sessionId,
      'B goes directly above A using the response that promoted B',
    )
    const beforeCommit = order()

    await render([aDone, bDone])
    assert.deepEqual(order(), beforeCommit, 'full-list commit must not cause another reorder')
    await receive([a, b])
    assert.deepEqual(order(), beforeCommit, 'stale responses cannot move either task back')
  })
})

test.each([
  ['together', [0, 1]],
  ['latest-first', [1, 0]],
  ['oldest-first', [0, 1]],
] as const)(
  '%s completion delivery keeps timestamp order before list refresh',
  async (name, indices) => {
    await withOrdering(async ({ receive, render, order }) => {
      const rows = [conversation(`${name}-a`, 1), conversation(`${name}-b`, 2)]
      const done = [
        conversation(rows[0].sessionId, 10, 2, 1),
        conversation(rows[1].sessionId, 20, 2, 1),
      ]

      await receive(rows)
      await render(rows)
      if (name === 'together') await receive(done)
      else for (const index of indices) await receive([done[index]])
      assert.equal(order()[0], rows[1].sessionId)
      await render(done)
      assert.equal(order()[0], rows[1].sessionId)
    })
  },
)

test('new activity in an already-unread task updates rank without waiting for the full list', async () => {
  await withOrdering(async ({ receive, render, order }) => {
    const a = conversation('unread-a', 10, 2, 1)
    const b = conversation('unread-b', 20, 2, 1)

    await receive([a, b])
    await render([a, b])
    assert.equal(order()[0], b.sessionId)
    await receive([conversation(a.sessionId, 30, 3, 1)])
    assert.equal(order()[0], a.sessionId)
    await receive([a])
    assert.equal(order()[0], a.sessionId, 'an older timestamp cannot undo the new activity')
  })
})

test('a child completion raises its whole family using the child activity time', async () => {
  await withOrdering(async ({ receive, render, order }) => {
    const parent = conversation('family-parent', 1)
    const child = { ...conversation('family-child', 2), parentSessionId: parent.sessionId }
    const other = conversation('family-other', 20, 2, 1)
    const done = { ...child, activitySeq: 2, lastActiveAt: '2026-11-13T00:00:30Z' }

    await receive([parent, child, other])
    await render([parent, child, other])
    assert.equal(order()[0], other.sessionId)
    await receive([done])
    assert.deepEqual(order().slice(0, 2), [parent.sessionId, child.sessionId])
    await render([parent, done, other])
    assert.deepEqual(order().slice(0, 2), [parent.sessionId, child.sessionId])
  })
})
