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

const { BoxQuotaMeter } = await import('./BoxQuotaMeter')
const { createRoot } = await import('react-dom/client')

test('a plan with no computers says so in one line, with a way to choose a plan', async () => {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  let chose = 0

  try {
    await act(() =>
      root.render(
        createElement(BoxQuotaMeter, {
          usage: { limitVcpus: 0, subscribed: false, usedVcpus: 0, boxVcpus: 2 },
          adding: 2,
          onChoosePlan: () => {
            chose += 1
          },
        }),
      ),
    )
    const text = container.textContent ?? ''

    assert.match(text, /Your team's plan doesn't include cloud computers\./)
    assert.doesNotMatch(text, /vCPU/)
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Choose a plan',
    )

    assert.ok(button)
    await act(() => (button as unknown as HTMLElement).click())
    assert.equal(chose, 1)
  } finally {
    await act(() => root.unmount())
  }
})
