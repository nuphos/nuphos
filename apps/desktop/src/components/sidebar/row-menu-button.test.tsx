import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

const { RowMenuButton } = await import('./row-menu-button')

// One menu per row: the More button asks for the row's right-click menu, so
// Leave task and Leave chat are offered from both without a second item list.
test("the More button opens the row's right-click menu, by click and by Enter", async () => {
  const dom = new Window()
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
  const { createRoot } = await import('react-dom/client')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const menus: string[] = []

  try {
    await act(() =>
      root.render(
        createElement(
          'div',
          { onContextMenu: (event: { type: string }) => menus.push(event.type) },
          createElement(RowMenuButton, { title: 'Launch' }),
        ),
      ),
    )
    const button = container.querySelector('[aria-haspopup="menu"]') as unknown as HTMLElement

    await act(() => button.click())
    await act(() => {
      button.dispatchEvent(
        new dom.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as unknown as Event,
      )
    })
    assert.deepEqual(menus, ['contextmenu', 'contextmenu'])
  } finally {
    await act(() => root.unmount())
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
