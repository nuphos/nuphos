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
mock.module('../../components/ui/select', () => ({
  AppSelect: (props: {
    ariaLabel: string
    value: string
    options: { value: string; label: string }[]
    onValueChange: (value: string) => void
  }) =>
    createElement(
      'select',
      {
        'aria-label': props.ariaLabel,
        value: props.value,
        onChange: (event: { target: { value: string } }) => props.onValueChange(event.target.value),
      },
      props.options.map((option) =>
        createElement('option', { key: option.value, value: option.value }, option.label),
      ),
    ),
}))
// This Desktop's own state, as the main process broadcasts it; a test swaps it to re-render.
let local: Record<string, unknown> | null = null
const localListeners = new Set<() => void>()

function broadcast(next: Record<string, unknown>) {
  local = next
  for (const listener of localListeners) listener()
}

mock.module('../../hooks/useLocalRuntimeState', async () => {
  const { useSyncExternalStore } = await import('react')

  return {
    useLocalRuntimeState: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          localListeners.add(listener)

          return () => localListeners.delete(listener)
        },
        () => local,
      ),
  }
})
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
      appGetLoginItem: async () => ({ supported: true, openAtLogin: false }),
      appSetLoginItem: async (openAtLogin: boolean) => {
        calls.push(['loginItem', openAtLogin])

        return { supported: true, openAtLogin }
      },
      localRuntimeSetSleepPreferences: async (preferences: Record<string, unknown>) => {
        calls.push(['sleep', preferences])
        broadcast({ ...local, sleepPrevention: { ...SLEEP, ...preferences } })

        return { ...SLEEP, ...preferences }
      },
      localRuntimeOpenWorkspace: async () => {
        calls.push(['openWorkspace'])
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

const SLEEP = { mode: 'off', onlyOnAC: true, supported: true, active: false, reason: 'off' }
const HERE = {
  userId: 'u1',
  deviceId: 'd1',
  workspace: '/Users/jordan/Nuphos',
  sleepPrevention: SLEEP,
  agents: {},
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
      open: true,
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
      open: true,
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

const switchNamed = (container: { querySelector: (selector: string) => unknown }, name: string) =>
  container.querySelector(`[role="switch"][aria-label="${name}"]`) as HTMLButtonElement | null

test('on this computer, its own settings are reachable from Computer settings and change it', async () => {
  broadcast(HERE)
  const { container, calls, unmount } = await render(
    createElement(ComputerSettingsDialog, {
      open: true,
      device: device({ autoInstall: true }),
      teamId: 'team',
      onClose: () => {},
      onChanged: () => {},
    }),
  )

  try {
    // The login item is read once the dialog opens.
    await act(async () => {})
    const login = switchNamed(container, 'Open Nuphos at login')

    assert.ok(login, 'Open Nuphos at login is in Computer settings')
    await act(async () => login.click())
    assert.equal(
      switchNamed(container, 'Open Nuphos at login')?.getAttribute('aria-checked'),
      'true',
    )

    const sleep = container.querySelector(
      'select[aria-label="Prevent Mac auto-sleep"]',
    ) as unknown as HTMLSelectElement

    assert.ok(sleep, 'Prevent Mac auto-sleep is in Computer settings')
    assert.equal(sleep.value, 'off')
    await act(async () => {
      sleep.value = 'tasks'
      sleep.dispatchEvent(new window.Event('change', { bubbles: true }))
    })
    const power = switchNamed(container, 'Only while connected to power')

    assert.ok(power)
    await act(async () => power.click())
    assert.equal(
      (
        container.querySelector(
          'select[aria-label="Prevent Mac auto-sleep"]',
        ) as unknown as HTMLSelectElement
      ).value,
      'tasks',
    )
    assert.equal(
      switchNamed(container, 'Only while connected to power')?.getAttribute('aria-checked'),
      'false',
    )

    assert.ok(container.textContent?.includes('/Users/jordan/Nuphos'))
    const open = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Open',
    )

    assert.ok(open, 'the workspace folder opens from Computer settings')
    await act(async () => open.click())
    assert.deepEqual(calls, [
      ['loginItem', true],
      ['sleep', { ...SLEEP, mode: 'tasks' }],
      ['sleep', { ...SLEEP, mode: 'tasks', onlyOnAC: false }],
      ['openWorkspace'],
    ])
  } finally {
    await unmount()
  }
})

test('another computer’s settings hold only what it reports to the team', async () => {
  broadcast({ ...HERE, deviceId: 'elsewhere' })
  const { container, unmount } = await render(
    createElement(ComputerSettingsDialog, {
      open: true,
      device: device({ autoInstall: true }),
      teamId: 'team',
      onClose: () => {},
      onChanged: () => {},
    }),
  )

  try {
    await act(async () => {})
    assert.equal(container.querySelectorAll('[role="switch"]').length, 1)
    assert.equal(container.querySelector('select'), null)
    assert.ok(!container.textContent?.includes('Workspace folder'))
  } finally {
    await unmount()
  }
})
