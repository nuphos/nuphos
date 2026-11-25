import assert from 'node:assert/strict'

import { spyOn, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

const dom = new Window()
const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })

const { RuntimeLoginBody } = await import('./RuntimeLoginBody')
const { createRoot } = await import('react-dom/client')

type Props = Parameters<typeof RuntimeLoginBody>[0]

test('an installing agent shows how long its install has run and that it is a download', async () => {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  let now = 1_000_000
  const clock = spyOn(Date, 'now').mockImplementation(() => now)

  try {
    await act(() =>
      root.render(
        createElement(RuntimeLoginBody, {
          instance: { provider: 'cursor', local: { deviceLabel: 'MacBook' } },
          state: { login: { attemptId: 'a', installing: true }, reachable: true },
        } as unknown as Props),
      ),
    )
    let text = container.textContent ?? ''

    assert.match(text, /Installing Cursor on MacBook…/)
    assert.match(text, /0:00/)
    assert.match(text, /downloads Cursor from its maker/)

    now += 65_000
    await act(() => new Promise((resolve) => setTimeout(resolve, 1_100)))
    text = container.textContent ?? ''
    assert.match(text, /1:05/)
  } finally {
    clock.mockRestore()
    await act(() => root.unmount())
    container.remove()
  }
})
