import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
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

// The page lists its computers and, below them, two runtimes.
void mock.module('./AgentSection', () => ({
  AgentSection: ({ onCount }: { onCount: (count: number) => void }) => {
    onCount(2)

    return null
  },
}))

const { ComputersSection } = await import('./ComputersSection')
const { createRoot } = await import('react-dom/client')

test('the Computers page shows no item count, and its search says it searches runtimes', async () => {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  try {
    await act(() =>
      root.render(
        createElement(ComputersSection, {
          team: { id: 'team-1', role: 'ADMINISTRATOR' } as never,
          onOpenSection: () => {},
        }),
      ),
    )
    const search = container.querySelector('input')

    assert.equal(search?.getAttribute('placeholder'), 'Search runtimes')
    assert.doesNotMatch(container.textContent ?? '', /items?\b/)
  } finally {
    await act(() => root.unmount())
  }
})
