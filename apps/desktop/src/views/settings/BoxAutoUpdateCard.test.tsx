import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { AtlasTeam } from '../../types'

// Run with: cd apps/desktop && bun test src/views/settings/BoxAutoUpdateCard.test.tsx

mock.module('./shared', () => ({ AdminOnlyHint: () => createElement('p', null, 'admins only') }))

const { BoxAutoUpdateCard } = await import('./BoxAutoUpdateCard')

const team = (role: AtlasTeam['role'], boxAutoUpdate?: boolean) =>
  ({
    id: 't1',
    name: 'Acme',
    role,
    ...(boxAutoUpdate === undefined ? {} : { boxAutoUpdate }),
  }) as AtlasTeam

async function mount(shown: AtlasTeam) {
  const dom = new Window()
  const calls: unknown[][] = []
  const updates: AtlasTeam[] = []

  Object.assign(dom, {
    api: {
      atlasSetTeamBoxAutoUpdate: async (...args: unknown[]) => {
        calls.push(args)

        return { ...shown, boxAutoUpdate: args[1] as boolean }
      },
    },
  })
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createRoot } = await import('react-dom/client')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  await act(() =>
    root.render(
      createElement(BoxAutoUpdateCard, {
        team: shown,
        onTeamUpdated: (next) => updates.push(next),
      }),
    ),
  )
  const toggle = container.querySelector('[role="switch"]') as unknown as HTMLButtonElement

  return { container, toggle, calls, updates, unmount: () => act(() => root.unmount()) }
}

test('a team that never chose has automatic updates on, and an administrator turns them off', async () => {
  const { toggle, calls, updates, unmount } = await mount(team('ADMINISTRATOR'))

  try {
    assert.equal(toggle.getAttribute('aria-checked'), 'true')
    assert.equal(toggle.disabled, false)
    await act(async () => toggle.click())
    assert.deepEqual(calls, [['t1', false]])
    assert.equal(updates.at(-1)?.boxAutoUpdate, false)
  } finally {
    await unmount()
  }
})

test('a team that turned them off shows it, and only an administrator can change it', async () => {
  const { container, toggle, calls, unmount } = await mount(team('EDITOR', false))

  try {
    assert.equal(toggle.getAttribute('aria-checked'), 'false')
    assert.equal(toggle.disabled, true)
    await act(async () => toggle.click())
    assert.deepEqual(calls, [])
    assert.ok(container.textContent?.includes('admins only'))
  } finally {
    await unmount()
  }
})
