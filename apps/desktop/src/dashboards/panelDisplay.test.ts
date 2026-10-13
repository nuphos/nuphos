import assert from 'node:assert/strict'
import { test } from 'node:test'

import { panelDisplay } from './panelDisplay.ts'

import type { DashboardPanel, DashboardPanelSnapshot } from './schema'

const range = {
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-10-09T23:59:59.999Z',
  granularity: 'day' as const,
}
const previous = {
  status: 'complete',
  params: { ...range, periodEnd: '2026-10-08T23:59:59.999Z' },
  output: { kind: 'scalar', title: 'Cost', value: 42, unit: 'usd' },
} as DashboardPanelSnapshot

for (const status of [null, 'running', 'failed'] as const) {
  test(`shows the previous data period when the current run is ${status}`, () => {
    const panel = {
      currentSnapshot: status ? { status } : null,
      lastSuccessfulSnapshot: previous,
    } as DashboardPanel
    const display = panelDisplay(panel, range)

    assert.equal(display.snapshot, previous)
    assert.equal(display.rangeLabel, 'Data period 2026-10-01 – 2026-10-08 (UTC) · Awaiting update')
  })
}

test('newly completed current output replaces the fallback and removes its stale label', () => {
  const current = {
    ...previous,
    params: range,
    output: { kind: 'scalar', title: 'Cost', value: 50, unit: 'usd' },
  } as DashboardPanelSnapshot
  const display = panelDisplay(
    { currentSnapshot: current, lastSuccessfulSnapshot: previous } as DashboardPanel,
    range,
  )

  assert.equal(display.snapshot, current)
  assert.equal(display.rangeLabel, null)
})

test('never-run panels have neither output nor a stale label', () => {
  const display = panelDisplay(
    { currentSnapshot: null, lastSuccessfulSnapshot: null } as DashboardPanel,
    range,
  )

  assert.equal(display.snapshot, null)
  assert.equal(display.rangeLabel, null)
})
