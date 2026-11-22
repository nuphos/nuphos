import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { Item } from './types'

mock.module('./use-inbox-badge', () => ({
  useInboxBadge: (_team: string, sections: unknown) => sections,
}))

test('a Bot row shows no done count, and its finished sub-agents stay listed', async () => {
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
  const { SidebarSectionList } = await import('./sections-list')
  const { BOTS_SECTION } = await import('./chat-sections')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const row = (id: string, extra: Partial<Item> = {}): Item => ({
    key: `agent-session:${id}`,
    label: id,
    enabled: true,
    ...extra,
  })

  try {
    await act(() =>
      root.render(
        createElement(SidebarSectionList, {
          sections: [
            {
              title: BOTS_SECTION,
              items: [
                row('bot'),
                row('running-sub-agent', { parentKey: 'agent-session:bot' }),
                row('finished-sub-agent', { parentKey: 'agent-session:bot', finished: true }),
              ],
            },
          ],
          scope: { kind: 'team', teamId: 'finished' },
          active: '',
          teamView: true,
          newChatActive: false,
          archivingIds: new Set<string>(),
          isGroupCollapsed: () => false,
          toggleGroup: () => {},
          favoriteMatch: () => {},
          canFavorite: () => false,
          toggleFavorite: () => {},
          onItemMenu: () => {},
          onSelect: () => {},
        }),
      ),
    )
    const text = container.textContent ?? ''

    assert.ok(text.includes('bot'))
    assert.ok(text.includes('running-sub-agent'))
    assert.ok(text.includes('finished-sub-agent'))
    assert.ok(!/\bdone\b/.test(text))
    await act(() => root.unmount())
  } finally {
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
