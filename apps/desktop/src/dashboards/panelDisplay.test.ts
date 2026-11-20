import assert from 'node:assert/strict'
import { test } from 'node:test'

import { noAgentNotice, panelDisplay, panelNotice } from './panelDisplay.ts'

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

test('a run that found an integration gone or no agent says so, and nothing else does', () => {
  const failed = (kind: string, message: string) =>
    ({ status: 'failed', error: { kind, message } }) as DashboardPanelSnapshot

  assert.equal(
    panelNotice(
      failed('not_connected', 'Not connected: Grafana instance\n\npanel exited with code 1'),
    ),
    'Not connected: Grafana instance',
  )
  assert.equal(
    panelNotice(failed('no_runtime', "Agents on your own computer can't run dashboard panels.")),
    "Agents on your own computer can't run dashboard panels.",
  )
  assert.equal(panelNotice(failed('nonzero_exit', 'panel exited with code 1')), null)
  assert.equal(panelNotice(null), null)
})

test('with no agent to run a panel, only someone who may rent a computer is offered one', () => {
  const backend =
    "Agents on your own computer can't run dashboard panels. A team agent or a computer from Nuphos can. Ask a team admin to rent one, then refresh."
  const member = noAgentNotice(backend, false)
  const admin = noAgentNotice(backend, true)

  // A member gets no button, and the backend's words send them to a team admin.
  assert.deepEqual(member, { text: backend, offerComputer: false })
  assert.match(member.text, /Ask a team admin to rent one/u)
  assert.equal(admin.offerComputer, true)
  assert.match(admin.text, /A team agent or a computer from Nuphos can\. Rent one, then refresh\./u)
})
