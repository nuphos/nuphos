import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { AgentDevice } from '../../api'
import type { ReactNode } from 'react'

// Run with: cd apps/desktop && bun test src/views/settings/ComputerSettingsDialog.test.tsx

mock.module('../../components/Modal', () => ({
  Modal: (props: { title: string; children: ReactNode; footer: ReactNode }) =>
    createElement(
      'div',
      { role: 'dialog', 'aria-label': props.title },
      props.children,
      props.footer,
    ),
}))
mock.module('../../components/ui/menu', () => ({
  MenuItem: (props: { children: ReactNode; onClick: () => void }) =>
    createElement('div', { role: 'menuitem', onClick: props.onClick }, props.children),
}))

const { ComputerSettingsDialog, ComputerSettingsMenuItem } =
  await import('./ComputerSettingsDialog')

async function render(element: ReturnType<typeof createElement>) {
  const dom = new Window()
  const calls: unknown[][] = []

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

  await act(() => root.render(element))

  return { container, calls, unmount: () => act(() => root.unmount()) }
}

const device = (over: Partial<AgentDevice>) =>
  ({ deviceId: 'd1', label: 'Build server', online: true, ...over }) as AgentDevice

test('the menu offers Settings… once the computer has reported its switch', async () => {
  for (const [autoInstall, shown] of [
    [undefined, false],
    [true, true],
  ] as const) {
    const { container, unmount } = await render(
      createElement(ComputerSettingsMenuItem, {
        device: device({ autoInstall }),
        onOpen: () => {},
      }),
    )

    assert.equal(
      container.querySelector('[role="menuitem"]')?.textContent ?? null,
      shown ? 'Settings…' : null,
    )
    await unmount()
  }
})

test('online, turning the switch off changes it on the computer and refreshes the card', async () => {
  let changed = 0
  const { container, calls, unmount } = await render(
    createElement(ComputerSettingsDialog, {
      device: device({ autoInstall: true }),
      teamId: 'team',
      onClose: () => {},
      onChanged: () => {
        changed++
      },
    }),
  )
  const toggle = () => container.querySelector('[role="switch"]') as unknown as HTMLButtonElement

  try {
    assert.equal(toggle().getAttribute('aria-checked'), 'true')
    await act(async () => toggle().click())
    assert.deepEqual(calls, [['d1', 'team', false]])
    assert.equal(changed, 1)
    assert.equal(toggle().getAttribute('aria-checked'), 'false')
  } finally {
    await unmount()
  }
})

test('offline, it shows the last switch it reported and cannot change it', async () => {
  const { container, calls, unmount } = await render(
    createElement(ComputerSettingsDialog, {
      device: device({ autoInstall: false, online: false }),
      teamId: 'team',
      onClose: () => {},
      onChanged: () => {},
    }),
  )
  const toggle = container.querySelector('[role="switch"]') as unknown as HTMLButtonElement

  try {
    assert.equal(toggle.getAttribute('aria-checked'), 'false')
    assert.equal(toggle.disabled, true)
    assert.ok(container.textContent?.includes('This computer is offline.'))
    await act(async () => toggle.click())
    assert.deepEqual(calls, [])
  } finally {
    await unmount()
  }
})
