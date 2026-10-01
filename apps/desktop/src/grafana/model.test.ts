import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ALL_VALUE,
  applyVariableRegex,
  normalizeDashboard,
  substituteVars,
  variableQueryValue,
} from './model.ts'
import { buildPanelQueryGroups } from './panelQuery.ts'

import type { Panel, Variable } from './types.ts'

// Run with: pnpm test  (node --experimental-strip-types --test; Node >= 22.6)

function variable(p: Partial<Variable>): Variable {
  return {
    name: 'v',
    type: 'query',
    currentValue: '',
    currentText: '',
    currentValues: [],
    currentTexts: [],
    ...p,
  }
}

test('variableQueryValue: single-value variable passes through', () => {
  assert.equal(variableQueryValue(variable({}), ['prod']), 'prod')
})

test('variableQueryValue: multi "All" expands to match-everything, not the literal sentinel', () => {
  const v = variable({ multi: true, includeAll: true })

  assert.equal(variableQueryValue(v, [ALL_VALUE]), '.*')
  assert.equal(variableQueryValue(v, []), '.*')
})

test('variableQueryValue: custom allValue wins over the default', () => {
  const v = variable({ multi: true, includeAll: true, allValue: '.+' })

  assert.equal(variableQueryValue(v, [ALL_VALUE]), '.+')
})

test('variableQueryValue: several picks become an escaped alternation', () => {
  const v = variable({ multi: true, includeAll: true })

  assert.equal(variableQueryValue(v, ['/v1/run']), '/v1/run')
  // Single picks in multi variables land in =~ matchers — specials escaped.
  assert.equal(variableQueryValue(v, ['api.v1']), 'api\\.v1')
  assert.equal(variableQueryValue(v, ['/v1/run', '/v1/runs/:runId']), '(/v1/run|/v1/runs/:runId)')
  assert.equal(variableQueryValue(v, ['a.b', 'c|d']), '(a\\.b|c\\|d)')
})

test('substituteVars leaves unknown variables untouched', () => {
  assert.equal(
    substituteVars('rate(m{env="$env",route=~"$route"}[5m])', { env: 'prod' }),
    'rate(m{env="prod",route=~"$route"}[5m])',
  )
})

const RAW_DASHBOARD = {
  uid: 'monid-mcp',
  title: 'monid — MCP (RED)',
  templating: {
    list: [
      {
        name: 'env',
        label: 'Environment',
        type: 'query',
        datasource: { type: 'prometheus', uid: 'grafanacloud-prom' },
        query: { query: 'label_values(m_total, deployment_environment)', refId: 'q' },
        current: { text: 'prod', value: 'prod' },
      },
      {
        name: 'route',
        label: 'Route',
        type: 'query',
        multi: true,
        includeAll: true,
        datasource: { type: 'prometheus', uid: 'grafanacloud-prom' },
        query: { query: 'label_values(m_total{deployment_environment="$env"}, route)', refId: 'q' },
        current: { text: 'All', value: '$__all' },
      },
    ],
  },
  panels: [
    {
      id: 3,
      type: 'stat',
      title: 'Request rate',
      gridPos: { x: 0, y: 0, w: 6, h: 5 },
      targets: [{ refId: 'A', expr: 'sum(rate(m_total[5m]))', instant: true, range: false }],
    },
    {
      id: 15,
      type: 'row',
      title: 'Focus: $route',
      repeat: 'route',
      collapsed: true,
      gridPos: { x: 0, y: 5, w: 24, h: 1 },
      panels: [
        {
          id: 17,
          type: 'stat',
          title: 'Focus req/s',
          gridPos: { x: 0, y: 3, w: 6, h: 5 },
          targets: [{ refId: 'A', expr: 'sum(rate(m_total[5m]))', instant: true, range: false }],
        },
      ],
    },
  ],
} as never

test('normalizeDashboard keeps multi/includeAll and the variable query', () => {
  const d = normalizeDashboard(RAW_DASHBOARD)
  const route = d.variables.find((v) => v.name === 'route')

  assert.ok(route)
  assert.equal(route.multi, true)
  assert.equal(route.includeAll, true)
  assert.equal(route.query, 'label_values(m_total{deployment_environment="$env"}, route)')
  assert.equal(route.datasource?.uid, 'grafanacloud-prom')
  assert.deepEqual(route.currentValues, ['$__all'])
})

test('normalizeDashboard keeps collapsed-row nested panels and target instant flags', () => {
  const d = normalizeDashboard(RAW_DASHBOARD)
  const row = d.panels.find((p) => p.type === 'row')

  assert.ok(row)
  assert.equal(row.collapsed, true)
  assert.equal(row.repeat, 'route')
  assert.equal(row.panels?.length, 1)
  assert.equal(row.panels?.[0].id, 17)
  const stat = d.panels.find((p) => p.id === 3)

  assert.equal(stat?.targets[0].instant, true)
  assert.equal(stat?.targets[0].range, false)
})

test('applyVariableRegex filters values, extracts capture groups, dedupes', () => {
  const values = ['prod-us', 'prod-eu', 'dev-us', 'plain']

  assert.deepEqual(applyVariableRegex(values, undefined), values)
  assert.deepEqual(applyVariableRegex(values, '/^prod-/'), ['prod-us', 'prod-eu'])
  assert.deepEqual(applyVariableRegex(values, '/^(?:prod|dev)-(.+)$/'), ['us', 'eu'])
  assert.deepEqual(applyVariableRegex(values, '/[invalid('), values)
})

const MULTI_DATASOURCE_PANEL: Panel = {
  id: 62,
  type: 'timeseries',
  title: 'CPU usage',
  gridPos: { x: 0, y: 0, w: 12, h: 8 },
  datasource: { type: 'victoriametrics-metrics-datasource', uid: '${servers}' },
  targets: [
    { refId: 'A', expr: 'sum(rate(cpu_total{env="$env"}[$__rate_interval]))' },
    { refId: 'B', expr: 'sum(memory_bytes{env="$env"})', instant: true, range: false },
  ],
}

test('multi datasource variables fan out into one query group per concrete UID', () => {
  const groups = buildPanelQueryGroups(MULTI_DATASOURCE_PANEL, {
    range: { from: 0, to: 3_600_000 },
    variables: { servers: '(uid-a|uid-b)', env: 'prod' },
    datasourceVariables: { servers: ['uid-a', 'uid-b'] },
  })

  assert.equal(groups.length, 2)
  assert.deepEqual(
    groups.map((group) =>
      group.queries.map((query) => ({
        refId: query.refId,
        uid: (query.datasource as { uid: string }).uid,
      })),
    ),
    [
      [
        { refId: 'A', uid: 'uid-a' },
        { refId: 'B', uid: 'uid-a' },
      ],
      [
        { refId: 'A', uid: 'uid-b' },
        { refId: 'B', uid: 'uid-b' },
      ],
    ],
  )
  assert.equal(groups[0].queries[0].expr, 'sum(rate(cpu_total{env="prod"}[15s]))')
  assert.equal(groups[0].queries[1].instant, true)
  assert.equal(groups[0].queries[1].range, false)
})

test('an unresolved All datasource selection never becomes a regex datasource UID', () => {
  const groups = buildPanelQueryGroups(MULTI_DATASOURCE_PANEL, {
    range: { from: 0, to: 3_600_000 },
    variables: { servers: '.*', env: 'prod' },
    datasourceVariables: { servers: [] },
  })

  assert.deepEqual(groups, [])
})

test('a fixed datasource keeps all panel targets in one query group', () => {
  const panel: Panel = {
    ...MULTI_DATASOURCE_PANEL,
    datasource: { type: 'prometheus', uid: 'prom-main' },
  }
  const groups = buildPanelQueryGroups(panel, {
    range: { from: 0, to: 3_600_000 },
    variables: { env: 'prod' },
  })

  assert.equal(groups.length, 1)
  assert.equal(groups[0].queries.length, 2)
  assert.equal((groups[0].queries[0].datasource as { uid: string }).uid, 'prom-main')
})
