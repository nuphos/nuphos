import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

import { SidebarPinShelf } from './SidebarPinShelf.tsx'

test('pin shelf measures layout height without counting the outgoing FLIP row', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  }
  const original = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  // A departing second row remains visually translated below the single layout row.
  Object.defineProperty(dom.HTMLElement.prototype, 'scrollHeight', { get: () => 220 })
  Object.defineProperty(dom.HTMLElement.prototype, 'offsetHeight', { get: () => 116 })
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  try {
    await act(() => root.render(createElement(SidebarPinShelf, { open: true }, 'pins')))
    assert.equal(container.firstElementChild?.getAttribute('style'), 'height: 116px;')
    await act(() => root.render(createElement(SidebarPinShelf, { open: false }, 'pins')))
    assert.equal(container.firstElementChild?.getAttribute('style'), 'height: 0px;')
  } finally {
    await act(() => root.unmount())
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
