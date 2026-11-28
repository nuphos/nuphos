import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { ReactNode } from 'react'

// Run with: cd apps/desktop && bun test src/views/settings/BoxAgentSetup.test.tsx

mock.module('../../components/Modal', () => ({
  Modal: (props: { title: string; children: ReactNode; footer: ReactNode }) =>
    createElement(
      'div',
      { role: 'dialog', 'aria-label': props.title },
      props.children,
      props.footer,
    ),
}))

const dom = new Window()
const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
browser.Event = dom.Event
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
Object.assign(dom, {
  api: {
    boxCreateAgent: async () => ({
      runtimeId: 'rt1',
      instanceId: 'i1',
      provider: 'cursor',
      label: 'Cursor',
    }),
    // OpenCode's free models, or a runtime already signed in, finish with no prompt.
    atlasStartRuntimeLogin: async () => ({ attemptId: 'a', state: 'connected' }),
  },
})

const { BoxAgentSetup } = await import('./BoxAgentSetup')
const { createRoot } = await import('react-dom/client')

test('a runtime that is set up says it is ready until Done', async () => {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const done: (string | null)[] = []

  try {
    await act(() =>
      root.render(
        createElement(BoxAgentSetup, {
          teamId: 't1',
          device: { deviceId: 'd1', label: 'Atlas Studio' },
          provider: 'cursor',
          agents: [],
          onDone: (runtimeId: string | null) => done.push(runtimeId),
        } as unknown as Parameters<typeof BoxAgentSetup>[0]),
      ),
    )
    const form = container.querySelector('form')

    assert.ok(form)
    await act(async () => {
      form.dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    const text = container.textContent ?? ''

    assert.equal(
      container.querySelector('[role="dialog"]')?.getAttribute('aria-label'),
      'Cursor runtime added',
    )
    assert.match(text, /Cursor is ready on Atlas Studio/)
    assert.match(text, /Bots and tasks can now run on it\./)
    assert.deepEqual(done, [])

    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Done')

    assert.ok(button)
    await act(() => button.click())
    assert.deepEqual(done, ['rt1'])
  } finally {
    await act(() => root.unmount())
    container.remove()
  }
})
