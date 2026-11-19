import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { NuphosDashboardDetail } from '../schema'

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

// Reads the team role and the signed-in user, which this test does not need.
mock.module('./VisibilityMenu', () => ({ VisibilityMenu: () => null }))

const { DashboardToolbar } = await import('./DashboardToolbar')
const { createRoot } = await import('react-dom/client')

const detail: NuphosDashboardDetail = {
  canEdit: true,
  dashboard: {
    id: 'd1',
    teamId: 't1',
    name: 'Nuphos',
    layout: [],
    timeRange: {
      periodStart: '2026-10-21T00:00:00.000Z',
      periodEnd: '2026-11-19T23:59:59.999Z',
      granularity: 'day',
    },
    rangePreset: 'last30',
    cadence: 'daily',
    nextRefreshAt: '2026-11-20T00:00:00.000Z',
    lastScheduledRefreshAt: '2026-11-19T00:00:00.000Z',
    visibility: 'team',
    createdBy: 'u1',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-11-19T00:00:00.000Z',
  },
  panels: [],
}

// #3821: these were portaled into the page header, which a dashboard in the panel beside a chat lacks.
test('an open dashboard has its own Refresh button and auto-refresh menu', async () => {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  let refreshed = 0

  try {
    await act(() =>
      root.render(
        createElement(DashboardToolbar, {
          teamId: 't1',
          onDefaultSaved: async () => {},
          detail,
          customRange: null,
          setCustomRange: () => {},
          refreshing: false,
          lastRefreshAt: '2026-11-19T00:01:00.000Z',
          onRefresh: () => {
            refreshed += 1
          },
          editingLayout: false,
          setEditingLayout: () => {},
          applyDate: () => {},
          onAddPanel: () => {},
          openPanelAssistant: () => {},
          onSaved: () => {},
        }),
      ),
    )
    const buttons = [...container.querySelectorAll('button')]
    const refresh = buttons.find((b) => b.getAttribute('aria-label') === 'Refresh')

    assert.ok(refresh, 'a Refresh button')
    assert.ok(
      buttons.some((b) => /Auto-refresh:\s*Daily/.test(b.textContent ?? '')),
      'an auto-refresh menu showing the cadence',
    )
    await act(() => (refresh as unknown as HTMLElement).click())
    assert.equal(refreshed, 1)
  } finally {
    await act(() => root.unmount())
    container.remove()
  }
})
