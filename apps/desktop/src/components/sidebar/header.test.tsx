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

const { SidebarTeamSwitcher } = await import('./header')
const { createRoot } = await import('react-dom/client')

test('workspace menu opens computer management directly above the unchanged settings entries', async () => {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const actions: string[] = []

  try {
    await act(() =>
      root.render(
        createElement(SidebarTeamSwitcher, {
          loading: false,
          teamSegment: { label: 'Example workspace' },
          onOpenComputers: () => actions.push('computers'),
          onOpenSettings: () => actions.push('settings'),
          onOpenMyPreferences: () => actions.push('preferences'),
        }),
      ),
    )
    await act(async () => {
      container.querySelector('button')!.click()
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    const items = [...dom.document.querySelectorAll('[role="menuitem"]')]

    assert.deepEqual(
      items.map((item) => item.textContent?.trim().replace(/Team settings.*/, 'Team settings')),
      ['Computers & runtimes', 'Team settings', 'My preferences', 'Switch workspace'],
    )
    await act(() => (items[0] as unknown as HTMLElement).click())
    assert.deepEqual(actions, ['computers'])
  } finally {
    await act(() => root.unmount())
  }
})
