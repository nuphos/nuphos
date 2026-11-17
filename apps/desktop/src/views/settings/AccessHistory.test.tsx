import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

const asked: (string | undefined)[] = []

async function mount() {
  const dom = new Window()

  Object.assign(dom, {
    api: {
      atlasListTeamMembers: async () => [
        { id: 'bryan', name: 'Bryan', email: 'bryan@acme.dev' },
        { id: 'leo', name: 'Leo', email: 'leo@acme.dev' },
      ],
      deviceAccessHistory: async (_device: string, _team: string, before?: string) => {
        asked.push(before)

        return before
          ? {
              entries: [
                {
                  id: 'b',
                  actorUserId: 'bryan',
                  via: 'share',
                  previous: null,
                  next: { everyone: true, userIds: [], managerIds: [] },
                  changedAt: '2026-11-10T00:00:00Z',
                },
              ],
              nextCursor: null,
            }
          : {
              entries: [
                {
                  id: 'a',
                  actorUserId: 'bryan',
                  via: 'conversation_invite',
                  previous: { everyone: false, userIds: [], managerIds: [] },
                  next: { everyone: false, userIds: ['leo'], managerIds: [] },
                  changedAt: '2026-11-16T00:00:00Z',
                },
              ],
              nextCursor: 'older',
            }
      },
    },
  })
  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createRoot } = await import('react-dom/client')
  const { AccessHistory } = await import('./AccessHistory')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  await act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(AccessHistory, { deviceId: 'mac', teamId: 'team' }),
      ),
    ),
  )

  return { container, unmount: () => act(() => root.unmount()) }
}

const button = (container: { querySelectorAll: (s: string) => Iterable<unknown> }, text: string) =>
  [...(container.querySelectorAll('button') as Iterable<HTMLElement>)].find(
    (one) => one.textContent === text,
  )!

test('opening the history lists who changed access, how, and loads older on request', async () => {
  asked.length = 0
  const { container, unmount } = await mount()
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

  try {
    assert.deepEqual(asked, [])
    await act(() => button(container, 'Access history').click())
    await settle()
    assert.deepEqual(asked, [undefined])
    assert.match(container.textContent ?? '', /Bryan · .* · when inviting them to a chat/)
    assert.match(container.textContent ?? '', /Leo can now use it/)
    await act(() => button(container, 'Show older').click())
    await settle()
    assert.deepEqual(asked, [undefined, 'older'])
    assert.match(container.textContent ?? '', /Shared with everyone in the team/)
    assert.equal(
      [...(container.querySelectorAll('button') as Iterable<HTMLElement>)].some(
        (one) => one.textContent === 'Show older',
      ),
      false,
    )
  } finally {
    await unmount()
  }
})
