import assert from 'node:assert/strict'

import { test } from 'bun:test'
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

const { Tooltip } = await import('./tooltip')
const { createRoot } = await import('react-dom/client')

// #3961: a closing dialog hands focus back to the button that opened it. That focus must not open
// the button's tooltip, or the tooltip shows unasked and takes the next Esc.
test('focus opens the tooltip only when a key moved it there', async () => {
  const container = dom.document.createElement('div')
  const other = dom.document.createElement('button')

  dom.document.body.append(other, container)
  const root = createRoot(container as unknown as HTMLElement)

  await act(() =>
    root.render(
      createElement(Tooltip, {
        content: 'Edit this Bot',
        delay: 0,
        trigger: createElement('button', { 'aria-label': 'Edit Bot' }),
        children: 'pencil',
      }),
    ),
  )
  const button = dom.document.querySelector('[aria-label="Edit Bot"]') as unknown as HTMLElement
  const press = (key: string) =>
    act(() => {
      dom.document.dispatchEvent(new dom.KeyboardEvent('keydown', { key, bubbles: true }))
    })
  const shown = () => dom.document.body.textContent?.includes('Edit this Bot') ?? false

  await press('Escape')
  await act(() => button.focus())
  assert.equal(shown(), false, 'focus returned after Esc closed a dialog')
  await act(() => (other as unknown as HTMLElement).focus())
  await press('Tab')
  await act(() => button.focus())
  assert.equal(shown(), true, 'focus moved there with Tab')
  await act(() => root.unmount())
  container.remove()
  other.remove()
})
