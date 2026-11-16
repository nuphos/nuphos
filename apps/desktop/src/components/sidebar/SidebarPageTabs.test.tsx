import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SidebarPageTabs } from './SidebarPageTabs'

test('Bots, Tasks and Inbox each expose their own count, with no zero badge', () => {
  const view = (botCount: number) =>
    renderToStaticMarkup(
      createElement(SidebarPageTabs, {
        page: 0,
        onPage: () => {},
        counts: [botCount, 3, 5],
      }),
    )

  assert.match(view(2), /aria-label="Bots · 2"/)
  assert.match(view(2), /aria-label="Tasks · 3"/)
  assert.match(view(2), /aria-label="Inbox · 5"/)
  assert.match(view(0), /aria-label="Bots"/)
  assert.doesNotMatch(view(0), /Bots · 0/)
})

test('native IPC shortcuts use the current order and unsubscribe on unmount', async () => {
  const { Window } = await import('happy-dom')
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { sidebarTabOrder, setSidebarTabOrder } = await import('./sidebar-tab-order')
  const dom = new Window()
  const listeners = new Set<(action: string) => void>()

  Object.assign(dom, {
    api: {
      onAppShortcut: (cb: (action: string) => void) => {
        listeners.add(cb)

        return () => listeners.delete(cb)
      },
    },
  })
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const originals = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const previous = sidebarTabOrder()
  const pages: number[] = []
  const emit = (action: string) => {
    for (const cb of listeners) cb(action)
  }

  try {
    await act(() =>
      root.render(
        createElement(SidebarPageTabs, {
          page: 0,
          onPage: (page) => pages.push(page),
          counts: [0, 0, 0],
        }),
      ),
    )
    assert.equal(listeners.size, 1)
    await act(() => emit('select-sidebar-tab-3'))
    assert.deepEqual(pages, [2])
    await act(() => setSidebarTabOrder([2, 0, 1]))
    await act(() => emit('select-sidebar-tab-2'))
    assert.deepEqual(pages, [2, 0])
    const modal = dom.document.createElement('div')

    modal.setAttribute('aria-modal', 'true')
    dom.document.body.append(modal)
    await act(() => emit('select-sidebar-tab-1'))
    assert.deepEqual(pages, [2, 0])
    modal.remove()
    const { isMac } = await import('../../lib/platform')
    const control = (type: string, down: boolean) =>
      dom.dispatchEvent(
        new dom.KeyboardEvent(type, {
          key: isMac ? 'Control' : 'Alt',
          ctrlKey: down && isMac,
          altKey: down && !isMac,
        }),
      )

    await act(() => control('keydown', true))
    assert.equal(container.querySelectorAll('[data-sidebar-shortcut-hint]').length, 0)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 650))
    })
    assert.deepEqual(
      [...container.querySelectorAll('[data-sidebar-shortcut-hint]')].map((el) => el.textContent),
      ['1', '2', '3'],
    )
    await act(() => control('keyup', false))
    assert.equal(container.querySelectorAll('[data-sidebar-shortcut-hint]').length, 0)
    await act(() => {
      control('keydown', true)
      control('keyup', false)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 650))
    })
    assert.equal(container.querySelectorAll('[data-sidebar-shortcut-hint]').length, 0)
  } finally {
    await act(() => root.unmount())
    assert.equal(listeners.size, 0)
    setSidebarTabOrder(previous)
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
