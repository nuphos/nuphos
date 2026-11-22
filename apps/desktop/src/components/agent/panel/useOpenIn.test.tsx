import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import { useOpenIn } from './useOpenIn'

test('a menu opened in one chat is closed by a switch, there and on the way back', async () => {
  const dom = new Window()
  const values = { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true }

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createRoot } = await import('react-dom/client')
  let state: ReturnType<typeof useOpenIn> = [false, () => {}]
  const Probe = ({ sessionId }: { sessionId: string }) => {
    state = useOpenIn(sessionId)

    return null
  }
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement)
  const show = (sessionId: string) => act(() => root.render(createElement(Probe, { sessionId })))

  await show('a')
  await act(() => state[1](true))
  assert.equal(state[0], true)
  await show('b')
  assert.equal(state[0], false)
  await show('a')
  assert.equal(state[0], false)
  await act(() => root.unmount())
})
