import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { createElement } from 'react'

let calls = 0

mock.module('../../api', () => ({
  api: {
    boxListDevices: async () => {
      calls += 1
      if (calls === 1) throw new Error('The operation was aborted due to timeout')

      return { devices: [], boxAvailable: true }
    },
  },
}))
mock.module('./boxPresentation', () => ({ BOX_CREATING_POLL_MS: 1 }))

const { useAgentDevices } = await import('./useAgentDevices')

test('a first load that fails is retried until a list arrives', async () => {
  const { Window } = await import('happy-dom')
  const dom = new Window()
  const values = { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true }

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const seen: { list: unknown; error: boolean }[] = []
  const Probe = () => {
    const { list, error } = useAgentDevices(() => 0)

    seen.push({ list, error })

    return null
  }
  const root = createRoot(dom.document.createElement('div') as unknown as HTMLElement)

  try {
    await act(async () => root.render(createElement(Probe)))
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))

    assert.ok(seen.some((state) => state.error), 'the first load failed')
    assert.equal(calls, 2)
    assert.deepEqual(seen.at(-1), { list: { devices: [], boxAvailable: true }, error: false })
  } finally {
    await act(async () => root.unmount())
    await dom.happyDOM.close()
  }
})
