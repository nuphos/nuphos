import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

import { useTextSwap } from './useTextSwap.ts'

function Label({ text }: { text: string }) {
  const swap = useTextSwap<HTMLSpanElement>(text)

  return createElement('span', { ref: swap.ref }, swap.text)
}

test('a label changed and changed back within the fade keeps the text it ended on', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    getComputedStyle: () => ({ getPropertyValue: () => '150ms' }),
  }

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { value, configurable: true })
  const host = dom.document.createElement('div')
  const root = createRoot(host as unknown as HTMLElement)

  await act(() => root.render(createElement(Label, { text: 'Continue' })))
  // A request that fails at once: busy, then idle again before the fade ends.
  await act(() => root.render(createElement(Label, { text: 'Sending…' })))
  await act(() => root.render(createElement(Label, { text: 'Continue' })))
  await act(() => new Promise((resolve) => setTimeout(resolve, 300)))

  assert.equal(host.textContent, 'Continue')
  assert.equal(host.querySelector('span')?.className, '')
  act(() => root.unmount())
  await dom.happyDOM.close()
})
