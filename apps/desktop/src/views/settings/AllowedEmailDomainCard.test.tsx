import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { AtlasTeam } from '../../types'

// Run with: cd apps/desktop && bun test src/views/settings/AllowedEmailDomainCard.test.tsx

const { AllowedEmailDomainCard } = await import('./AllowedEmailDomainCard')

async function render(team: AtlasTeam, userEmail: string) {
  const dom = new Window()
  const calls: unknown[][] = []
  const updates: AtlasTeam[] = []

  Object.assign(dom, {
    api: {
      atlasSetTeamEmailDomainDiscovery: async (...args: unknown[]) => {
        calls.push(args)

        return team
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

  const onTeamUpdated = (next: AtlasTeam) => {
    updates.push(next)
  }

  await act(() =>
    root.render(createElement(AllowedEmailDomainCard, { team, userEmail, onTeamUpdated })),
  )
  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')

  return { container, toggle, calls, updates, unmount: () => act(() => root.unmount()) }
}

const admin = (over: Partial<AtlasTeam>): AtlasTeam => ({
  id: 'team-1',
  name: 'Workspace',
  role: 'ADMINISTRATOR',
  allowedEmailDomains: [],
  ...over,
})

test('an admin on a public provider gets no usable switch and is told why', async () => {
  const { container, toggle, calls, unmount } = await render(
    admin({ viewerEmailDomainPublic: true }),
    'bryan@gmail.com',
  )

  assert.equal(toggle?.disabled, true)
  await act(() => toggle?.click())
  assert.deepEqual(calls, [])
  assert.match(container.textContent, /gmail\.com is a public email provider, so it can't be used/)
  await unmount()
})

test('an admin on a company domain can still turn discovery on', async () => {
  const { container, toggle, calls, updates, unmount } = await render(
    admin({ viewerEmailDomainPublic: false }),
    'pat@acme.com',
  )

  assert.equal(toggle?.disabled, false)
  assert.match(container.textContent, /Your email domain, taken from your account\./)
  await act(() => toggle?.click())
  assert.deepEqual(calls, [['team-1', true]])
  assert.equal(updates.length, 1)
  await unmount()
})

test('discovery already on for a company domain can still be turned off', async () => {
  const { container, toggle, unmount } = await render(
    admin({ allowedEmailDomains: ['acme.com'], viewerEmailDomainPublic: true }),
    'bryan@gmail.com',
  )

  assert.equal(toggle?.disabled, false)
  assert.equal(toggle?.getAttribute('aria-checked'), 'true')
  assert.match(container.textContent, /Teammates on this domain can join this workspace\./)
  await unmount()
})
