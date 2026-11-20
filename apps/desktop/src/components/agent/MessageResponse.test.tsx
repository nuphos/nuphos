import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { ChatLinkMenuActions } from './chatLinkMenuContext'

const { MessageResponse } = await import('./MessageResponse')
const { ChatLinkMenuContext } = await import('./chatLinkMenuContext')

// A question card on a Bot's page passed no link handler, so its links fell
// through to target=_blank and left the app; every surface must open them as
// the workspace does.
test('a link rendered without its own handler opens through the workspace one', async () => {
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
  const opened: [string, boolean][] = []
  const actions: ChatLinkMenuActions = {
    open: (href, beside) => {
      opened.push([href, beside])

      return true
    },
    openInApp: () => {},
    openExternal: () => assert.fail('the link must not leave the app'),
    copyLink: () => {},
  }

  try {
    await act(() =>
      root.render(
        createElement(
          ChatLinkMenuContext.Provider,
          { value: actions },
          createElement(MessageResponse, {
            streaming: false,
            children: 'See [the run](https://example.com/run/1).',
          }),
        ),
      ),
    )
    const link = container.querySelector('a')

    assert.ok(link, 'the body renders its link')
    const click = new dom.MouseEvent('click', { bubbles: true, cancelable: true })

    link.dispatchEvent(click)

    assert.deepEqual(opened, [['https://example.com/run/1', false]])
    assert.equal(click.defaultPrevented, true)
  } finally {
    act(() => root.unmount())
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete (globalThis as Record<string, unknown>)[key]
    }
  }
})
