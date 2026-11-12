import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { WorkspaceBotsStart } from './WorkspaceBotsStart'

test('Bots has its own main-pane creation/import state without a Task composer', () => {
  const html = renderToStaticMarkup(
    createElement(WorkspaceBotsStart, {
      teamId: 'empty-team',
      onOpen: () => {},
    }),
  )

  assert.ok(html.includes('Start with your first Bot'))
  assert.ok(html.includes('New Bot'))
  assert.ok(html.includes('Import from Grok Bot'))
  assert.ok(!html.includes('contenteditable'))
})

test('hiding and returning to Bots preserves its existing avatar and action nodes', async () => {
  const { Window } = await import('happy-dom')
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
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
  const onOpen = () => undefined
  const render = (visible: boolean) =>
    act(() =>
      root.render(
        createElement(WorkspaceBotsStart, {
          teamId: 'empty-team',
          visible,
          onOpen,
        }),
      ),
    )

  try {
    await render(true)
    const avatar = container.querySelector('img')
    const action = container.querySelector('button')

    assert.ok(avatar)
    assert.ok(action)
    await render(false)
    assert.ok(container.querySelector('main')?.classList.contains('hidden'))
    assert.equal(container.querySelector('main')?.getAttribute('aria-hidden'), 'true')
    assert.equal(container.querySelector('img'), avatar)
    await render(true)
    assert.equal(container.querySelector('img'), avatar)
    assert.equal(container.querySelector('button'), action)
  } finally {
    await act(() => root.unmount())
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
