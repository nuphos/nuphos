import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { Item } from './types'
import type { ReactNode } from 'react'

mock.module('../../api', () => ({ api: {} }))
mock.module('../ui/toast', () => ({ toast: { apiError: () => {} } }))
mock.module('./SidebarBotPins', () => ({
  SidebarBotPins: ({ children }: { children: ReactNode }) => children,
}))
mock.module('./sections-list', () => ({ SidebarSectionList: () => 'rows' }))

const bot: Item = { key: 'agent-session:b1', label: 'Bot', enabled: true, bot: true }

// `undefined` is a listing that has not arrived yet; `[]` one that arrived empty.
async function render(page: 0 | 1, chats: Item[] | undefined) {
  const dom = new Window()
  const values = {
    window: dom,
    navigator: dom.navigator,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    ResizeObserver: dom.ResizeObserver,
    MutationObserver: dom.MutationObserver,
    localStorage: dom.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const original = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { teamSections } = await import('./sections-services')
  const { withChatSections } = await import('./chat-sections')
  const { SidebarPageList } = await import('./SidebarPageList')
  const { createRoot } = await import('react-dom/client')
  const container = dom.document.createElement('div')
  const root = createRoot(container as unknown as HTMLElement)

  try {
    await act(() =>
      root.render(
        createElement(SidebarPageList, {
          page,
          sections: withChatSections(teamSections([], false, chats)),
          onScroll: () => {},
          listProps: {
            scope: { kind: 'team', teamId: 'sidebar-loading' },
            active: 'team.agent',
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
          },
        }),
      ),
    )

    // What a person sees: the skeleton while it loads, then the rows or the empty message.
    const state = container.querySelector('.t-skel')?.getAttribute('data-state')

    return `${state === 'loading' ? 'skeleton ' : ''}${container.textContent ?? ''}`
  } finally {
    await act(() => root.unmount())
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
}

test('Bots shows the skeleton, not "No Bots yet", before the first listing arrives', async () => {
  const text = await render(0, undefined)

  assert.ok(!text.includes('No Bots yet'), text)
  assert.ok(text.includes('skeleton'), text)
})

test('Tasks shows the skeleton, not "No tasks yet", before the first listing arrives', async () => {
  const text = await render(1, undefined)

  assert.ok(!text.includes('No tasks yet'), text)
  assert.ok(text.includes('skeleton'), text)
})

test('a listing that arrived empty says so on both pages', async () => {
  assert.ok((await render(0, [])).includes('No Bots yet'))
  assert.ok((await render(1, [])).includes('No tasks yet'))
})

test('a listing with a Bot shows its rows', async () => {
  const text = await render(0, [bot])

  assert.ok(!text.includes('No Bots yet'), text)
  assert.ok(text.includes('rows'), text)
})
