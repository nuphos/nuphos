import assert from 'node:assert/strict'
import test from 'node:test'

import { MAX_WATCH_GROUP_MEMBERS, planWatchSelection } from './watchSelection.ts'

import type { MonitoringOverviewRow } from '../../types'

function row(name: string): MonitoringOverviewRow {
  return {
    provider: 'grafana',
    kind: 'alert-rule',
    name,
    status: 'normal',
    integrationLabel: 'grafana.example.com',
    providerResourceId: name,
  } as MonitoringOverviewRow
}

test('nothing selected asks for nothing', () => {
  assert.deepEqual(planWatchSelection([]), { kind: 'none' })
})

test('one selected item is a plain Watch, not a group of one', () => {
  // trigger_group_create requires at least two members, so a "group" of one is
  // an instruction the agent cannot carry out — and a single item never wanted
  // a shared ingress in the first place.
  const only = row('a')

  assert.deepEqual(planWatchSelection([only]), { kind: 'single', row: only })
})

test('two or more selected items become a group', () => {
  const rows = [row('a'), row('b')]

  assert.deepEqual(planWatchSelection(rows), { kind: 'group', rows, truncated: false })
})

test('an oversized selection is capped and says so', () => {
  const rows = Array.from({ length: MAX_WATCH_GROUP_MEMBERS + 3 }, (_, i) => row(`a${String(i)}`))
  const plan = planWatchSelection(rows)

  assert.equal(plan.kind, 'group')
  if (plan.kind !== 'group') return
  assert.equal(plan.rows.length, MAX_WATCH_GROUP_MEMBERS)
  assert.equal(plan.truncated, true)
  assert.deepEqual(plan.rows, rows.slice(0, MAX_WATCH_GROUP_MEMBERS))
})

test('a selection exactly at the cap is not reported as truncated', () => {
  const rows = Array.from({ length: MAX_WATCH_GROUP_MEMBERS }, (_, i) => row(`a${String(i)}`))
  const plan = planWatchSelection(rows)

  assert.equal(plan.kind === 'group' && plan.truncated, false)
})
