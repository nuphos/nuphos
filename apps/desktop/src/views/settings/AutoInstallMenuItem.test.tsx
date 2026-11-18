import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { AgentDevice } from '../../api'
import type { ReactNode } from 'react'

// Run with: cd apps/desktop && bun test src/views/settings/AutoInstallMenuItem.test.tsx

mock.module('../../components/ui/menu', () => ({
  MenuItem: ({
    children,
    onClick,
    selected,
  }: {
    children: ReactNode
    onClick: () => void
    selected?: boolean
  }) =>
    createElement('div', { role: 'menuitem', 'aria-checked': String(selected), onClick }, children),
}))

const { AutoInstallMenuItem } = await import('./AutoInstallMenuItem')

async function mount(autoInstall: boolean | undefined) {
  const dom = new Window()
  const calls: unknown[][] = []
  let changed = 0

  Object.assign(dom, {
    api: {
      deviceSetAutoInstall: async (...args: unknown[]) => {
        calls.push(args)

        return { enabled: args[2] }
      },
    },
  })
  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createRoot } = await import('react-dom/client')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const device = {
    deviceId: 'd1',
    ...(autoInstall === undefined ? {} : { autoInstall }),
  } as AgentDevice

  await act(() =>
    root.render(
      createElement(AutoInstallMenuItem, {
        device,
        teamId: 'team',
        onChanged: () => {
          changed++
        },
      }),
    ),
  )

  return {
    item: container.querySelector('[role="menuitem"]') as unknown as HTMLElement | null,
    calls,
    changed: () => changed,
    unmount: () => act(() => root.unmount()),
  }
}

test('a computer that updates itself shows it checked, and a click turns it off there', async () => {
  const { item, calls, changed, unmount } = await mount(true)

  try {
    assert.ok(item)
    assert.equal(item.getAttribute('aria-checked'), 'true')
    await act(async () => item.click())
    assert.deepEqual(calls, [['d1', 'team', false]])
    assert.equal(changed(), 1)
  } finally {
    await unmount()
  }
})

test('a computer that reports no switch (offline, or an older Nuphos) shows none', async () => {
  const { item, unmount } = await mount(undefined)

  try {
    assert.equal(item, null)
  } finally {
    await unmount()
  }
})
