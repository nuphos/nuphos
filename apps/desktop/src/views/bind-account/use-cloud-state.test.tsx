import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import { useCloudProviderState } from './use-cloud-state'

// #3070: the dialog resets as it closes and stays mounted for its close
// transition, so a reset provider showed "Connect AWS" while closing.
test('resetting the form keeps the provider the dialog is titled with', async () => {
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
  const root = createRoot(container as unknown as HTMLElement)
  let state: ReturnType<typeof useCloudProviderState> | undefined

  function Probe() {
    state = useCloudProviderState('cloudflare')

    return null
  }

  try {
    await act(async () => root.render(createElement(Probe)))
    await act(async () => state?.resetCloudState())

    assert.equal(state?.provider, 'cloudflare')
  } finally {
    await act(async () => root.unmount())
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
