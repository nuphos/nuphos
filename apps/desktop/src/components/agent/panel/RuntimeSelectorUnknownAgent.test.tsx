import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { RuntimeInstance } from '../../../types/runtime'
import type { ReactNode } from 'react'

// A backend newer than this build can list an agent it does not know yet (#5012's Cursor).
// The picker and the chosen agent must still render, named by the agent's id.

// Base UI's menu does not render in happy-dom; an open menu renders its items.
const passthrough = ({ children }: { children?: ReactNode }) => createElement('div', null, children)

mock.module('../../ui/menu', () => ({
  Menu: passthrough,
  MenuTrigger: ({ children, title }: { children?: ReactNode; title?: string }) =>
    createElement('button', { title }, children),
  MenuContent: passthrough,
  MenuItem: ({ children }: { children?: ReactNode }) =>
    createElement('div', { role: 'menuitem' }, children),
  MenuSeparator: () => null,
  MenuSubmenu: passthrough,
  MenuSubmenuTrigger: passthrough,
}))
mock.module('../../../hooks/useThisComputer', () => ({ useThisComputer: () => null }))
mock.module('../../../hooks/useAgentUpdates', () => ({ useAgentUpdates: () => new Map() }))
mock.module('../../../views/settings/useAgentDevices', () => ({
  useAgentDevices: () => ({ list: null, error: false }),
}))
mock.module('./usePickerFixes', () => ({
  usePickerFixes: () => ({
    fixes: {
      viewer: {
        viewerId: 'u1',
        isTeamAdmin: false,
        onThisComputer: () => false,
        members: null,
      },
      run: () => {},
      busy: () => false,
      canAsk: () => false,
    },
    dialogs: null,
  }),
}))

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

const { RuntimeSelector } = await import('./RuntimeSelector')
const { createRoot } = await import('react-dom/client')

const cursor = {
  id: 'r-cursor',
  provider: 'cursor',
  label: 'Cursor on a test computer',
  status: 'active',
  kind: 'external',
  connection: 'paired',
  createdAt: '2026-11-24T00:00:00.000Z',
} as unknown as RuntimeInstance

test('an agent this build does not know renders in the picker and as the chosen one', async () => {
  const host = document.createElement('div')

  document.body.append(host)
  const root = createRoot(host)

  await act(async () =>
    root.render(
      createElement(RuntimeSelector, {
        teamId: 't1',
        menuOpen: true,
        value: { id: cursor.id, provider: cursor.provider, label: cursor.label },
        options: [cursor],
        onSelect: () => {},
      }),
    ),
  )

  assert.equal(host.querySelector('button')?.getAttribute('title'), `${cursor.label} · cursor`)
  assert.ok(
    [...host.querySelectorAll('[role="menuitem"]')].some((row) =>
      row.textContent?.includes(cursor.label),
    ),
  )
  await act(async () => root.unmount())
})
