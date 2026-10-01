import assert from 'node:assert/strict'
import { test } from 'node:test'

import { navigationFromAppPath, pageLocationForNavigation } from '../../lib/appRoutes.ts'

import { parseDashboardViewRange } from './range.ts'

type Query = Record<string, string>
const base = '/teams/team-1/dashboards/dashboard-1'

test('preset and custom view ranges survive URL round trips', () => {
  const queries: Query[] = [
    { preset: 'last7' },
    {
      periodStart: '2026-09-01T00:00:00.000Z',
      periodEnd: '2026-09-26T23:59:59.999Z',
      granularity: 'day',
    },
  ]

  for (const query of queries) {
    const first = navigationFromAppPath(`${base}?${new URLSearchParams(query)}`)!

    assert.deepEqual(first.nuphosDashboard?.viewRange, query)
    const produced = pageLocationForNavigation(first).href

    assert.deepEqual(navigationFromAppPath(produced)?.nuphosDashboard?.viewRange, query)
  }
})

test('two views of one dashboard keep independent ranges', () => {
  const first = navigationFromAppPath(`${base}?preset=last7`)!
  const second = navigationFromAppPath(`${base}?preset=prevMonth`)!

  assert.notEqual(pageLocationForNavigation(first).href, pageLocationForNavigation(second).href)
  assert.equal(pageLocationForNavigation(navigationFromAppPath(base)!).href, base)
})

test('malformed or partial query ranges do not enter view state', () => {
  for (const query of [
    'preset=invalid',
    'periodStart=2026-09-01',
    'periodStart=x&periodEnd=y',
    'preset=last7&periodStart=2026-09-01',
    'periodStart=2026-09-02&periodEnd=2026-09-01',
  ]) {
    assert.equal(parseDashboardViewRange(new URLSearchParams(query)), undefined)
  }
})
