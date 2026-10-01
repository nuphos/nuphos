import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DASHBOARDS_TITLE, dashboardsPageTitle } from './pageTitle.ts'

const list = [
  { id: 'a', name: 'AWS spend' },
  { id: 'b', name: 'GCP spend' },
]

test('the list page keeps the section title', () => {
  assert.equal(
    dashboardsPageTitle({ nuphosDashboard: null, nuphosDashboards: list, restoredTitle: 'X' }),
    DASHBOARDS_TITLE,
  )
})

test('an open dashboard is titled by its name', () => {
  assert.equal(
    dashboardsPageTitle({
      nuphosDashboard: { dashboardId: 'a', dashboardName: 'AWS spend' },
      nuphosDashboards: list,
      restoredTitle: undefined,
    }),
    'AWS spend',
  )
})

test('switching dashboards in the same tab follows the new one', () => {
  assert.equal(
    dashboardsPageTitle({
      nuphosDashboard: { dashboardId: 'b', dashboardName: 'GCP spend' },
      nuphosDashboards: list,
      restoredTitle: 'AWS spend',
    }),
    'GCP spend',
  )
})

test('a rename reported by the dashboard list wins over the stale ref name', () => {
  assert.equal(
    dashboardsPageTitle({
      nuphosDashboard: { dashboardId: 'a', dashboardName: 'AWS spend' },
      nuphosDashboards: [{ id: 'a', name: 'AWS spend (prod)' }],
      restoredTitle: undefined,
    }),
    'AWS spend (prod)',
  )
})

test('a restored tab shows its persisted title until the list loads', () => {
  const nuphosDashboard = { dashboardId: 'a', dashboardName: 'Dashboard' }

  assert.equal(
    dashboardsPageTitle({ nuphosDashboard, nuphosDashboards: undefined, restoredTitle: 'Old' }),
    'Old',
  )
  assert.equal(
    dashboardsPageTitle({ nuphosDashboard, nuphosDashboards: list, restoredTitle: 'Old' }),
    'AWS spend',
  )
})

test('falls back to the ref name when nothing better is known', () => {
  const nuphosDashboard = { dashboardId: 'new', dashboardName: 'Untitled dashboard' }

  assert.equal(
    dashboardsPageTitle({ nuphosDashboard, nuphosDashboards: undefined, restoredTitle: undefined }),
    'Untitled dashboard',
  )
  assert.equal(
    dashboardsPageTitle({ nuphosDashboard, nuphosDashboards: list, restoredTitle: 'Old' }),
    'Untitled dashboard',
  )
})
