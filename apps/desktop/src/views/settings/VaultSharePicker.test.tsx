import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement, useState } from 'react'

import type { VaultDevice } from '../../types/vault'

// Run with: cd apps/desktop && bun test src/views/settings/VaultSharePicker.test.tsx

// The locale is read in English before the window exists; the window is set before base-ui
// loads, as it reads the DOM globals when imported.
await import('../../i18n')
const dom = new Window()

for (const [key, value] of Object.entries({
  window: dom,
  document: dom.document,
  HTMLElement: dom.HTMLElement,
  Element: dom.Element,
  Node: dom.Node,
  navigator: dom.navigator,
  MutationObserver: dom.MutationObserver,
  ResizeObserver: dom.ResizeObserver,
  getComputedStyle: dom.getComputedStyle.bind(dom),
  requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
  cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, key, { configurable: true, value })

const { VaultSharePicker } = await import('./VaultSharePicker')

const device = (id: string, name: string, state: VaultDevice['state'] = 'enrolled') => ({
  id,
  name,
  state,
  fingerprint: `FP-${id}`,
})
const devices = [
  device('mac', 'This Mac'),
  device('studio', 'Studio Mac'),
  device('new', 'New Mac', 'pending'),
]

/** Renders the picker with its ids held in state, as the item row does, and opens it. */
async function open(chosen: string[], save?: (ids: string[]) => Promise<void>) {
  const { createRoot } = await import('react-dom/client')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const calls: string[][] = []

  function Harness() {
    const [ids, setIds] = useState(chosen)

    return createElement(VaultSharePicker, {
      devices,
      thisDeviceId: 'mac',
      chosen: ids,
      shared: chosen,
      variant: 'field',
      onReplaceValue: () => {},
      onChange: async (next: string[]) => {
        calls.push(next)
        await save?.(next)
        setIds(next)
      },
    })
  }

  await act(() => root.render(createElement(Harness)))
  await act(() => container.querySelector('button')?.click())
  const body = dom.document.body
  const box = (name: string) => {
    const found = body.querySelector(`[role="checkbox"][aria-label="${name}"]`)

    assert.ok(found, `a row for ${name}`)

    return found as unknown as HTMLElement
  }

  return { body, box, calls, unmount: () => act(() => root.unmount()) }
}

test('ticking a computer saves the new ids, and a pending one cannot be picked', async () => {
  const { body, box, calls, unmount } = await open(['mac'])

  assert.match(body.textContent, /1 of 2 selected · 1 waiting/)
  assert.equal(box('New Mac').getAttribute('aria-disabled'), 'true')
  await act(async () => box('New Mac').click())
  assert.deepEqual(calls, [])
  await act(async () => box('Studio Mac').click())
  assert.deepEqual(calls, [['mac', 'studio']])
  assert.match(body.textContent, /2 of 2 selected/)
  await unmount()
})

test('the last computer picked cannot be removed', async () => {
  const { body, box, calls, unmount } = await open(['studio'])

  assert.equal(box('Studio Mac').getAttribute('aria-disabled'), 'true')
  assert.match(body.textContent, /Only computer · can’t be removed/)
  await act(async () => box('Studio Mac').click())
  assert.deepEqual(calls, [])
  await unmount()
})

test('removing a computer that held the key warns that it may have kept the value', async () => {
  const { body, box, calls, unmount } = await open(['mac', 'studio'])

  assert.doesNotMatch(body.textContent, /may have kept/)
  await act(async () => box('This Mac').click())
  assert.deepEqual(calls, [['studio']])
  assert.match(body.textContent, /This Mac may have kept the value it already read\./)
  assert.match(body.textContent, /Replace value/)
  await unmount()
})

test('a refused change is shown in the list, which stays open with the ids unchanged', async () => {
  const { body, box, unmount } = await open(['mac'], async () => {
    throw new Error('The item changed since it was read')
  })

  await act(async () => box('Studio Mac').click())
  assert.match(body.textContent, /Could not update sharing: The item changed since it was read/)
  assert.equal(box('Studio Mac').getAttribute('aria-checked'), 'false')
  await unmount()
})
