import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nextRead, panelCardBody } from './homePanelState.ts'

import type { PanelRead } from './homePanelState.ts'
import type { DashboardPanel, DashboardPanelSnapshot } from '../../../dashboards/schema'

const output = { kind: 'scalar', title: 'Users', value: 3, unit: 'count' } as const

const snapshot = (over: Partial<DashboardPanelSnapshot>): DashboardPanelSnapshot =>
  ({ status: 'complete', output: null, error: null, ...over }) as DashboardPanelSnapshot

const panel = (over: Partial<DashboardPanel> = {}): DashboardPanel =>
  ({
    id: 'p1',
    title: 'Users',
    currentSnapshot: null,
    lastSuccessfulSnapshot: null,
    ...over,
  }) as DashboardPanel

const ok = (p: DashboardPanel | null): PanelRead => ({
  status: 'ok',
  dashboardName: 'Ops',
  panel: p,
})

test('a panel missing from its dashboard, or a deleted dashboard, is gone', () => {
  assert.deepEqual(panelCardBody(ok(null)), { kind: 'gone' })
  assert.deepEqual(panelCardBody({ status: 'not_found' }), { kind: 'gone' })
})

test('a failed read is not mistaken for a deleted panel', () => {
  assert.deepEqual(panelCardBody({ status: 'error' }), { kind: 'unreachable' })
  assert.deepEqual(panelCardBody(null), { kind: 'loading' })
})

test('a failed read keeps what was already showing', () => {
  const shown = ok(panel())

  assert.equal(nextRead(shown, { status: 'error' }), shown)
  assert.deepEqual(nextRead(null, { status: 'error' }), { status: 'error' })
  assert.deepEqual(nextRead(shown, { status: 'not_found' }), { status: 'not_found' })
})

test('the last successful output is drawn even while a new run is going', () => {
  const p = panel({
    lastSuccessfulSnapshot: snapshot({ output }),
    currentSnapshot: snapshot({ status: 'running' }),
  })

  assert.deepEqual(panelCardBody(ok(p)), { kind: 'output', output })
})

const reason = (p: DashboardPanel) => {
  const body = panelCardBody(ok(p))

  return body.kind === 'empty' ? body.reason : body.kind
}

test('an empty panel says why it has nothing to draw', () => {
  assert.equal(reason(panel()), 'never_run')
  assert.equal(reason(panel({ currentSnapshot: snapshot({ status: 'running' }) })), 'running')
  assert.equal(reason(panel({ currentSnapshot: snapshot({ status: 'failed' }) })), 'failed')
  assert.equal(reason(panel({ currentSnapshot: snapshot({ status: 'complete' }) })), 'no_output')
})
