import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizeFrame } from './model.ts'
import { buildTable, thresholdColor } from './table.ts'

import type { Panel } from './types.ts'

// Run with: pnpm test  (node --experimental-strip-types --test; Node >= 22.6)

// Shaped like the real /api/ds/query response for an instant Prometheus
// vector (resultType: "vector"): one frame per series, labels on the value
// field.
function vectorFrame(refId: string, labels: Record<string, string>, value: number) {
  return normalizeFrame(
    {
      schema: {
        refId,
        fields: [
          { name: 'Time', type: 'time' },
          { name: 'Value', type: 'number', labels },
        ],
      },
      data: { values: [[1783153139000], [value]] },
    },
    refId,
  )
}

// Trimmed from the monid-mcp "Top routes" panel.
const TABLE_PANEL: Panel = {
  id: 12,
  type: 'table',
  title: 'Top routes',
  gridPos: { x: 0, y: 24, w: 24, h: 10 },
  targets: [],
  transformations: [
    { id: 'merge' },
    {
      id: 'organize',
      options: {
        excludeByName: { Time: true, __name__: true, deployment_environment: true },
      },
    },
  ],
  fieldConfig: {
    overrides: [
      {
        matcher: { id: 'byRegexp', options: '.*Value #A.*' },
        properties: [
          { id: 'displayName', value: 'req/s' },
          { id: 'unit', value: 'reqps' },
          { id: 'decimals', value: 2 },
        ],
      },
      {
        matcher: { id: 'byRegexp', options: '.*Value #B.*' },
        properties: [
          { id: 'displayName', value: 'error rate' },
          { id: 'unit', value: 'percentunit' },
          { id: 'custom.cellOptions', value: { mode: 'gradient', type: 'color-background' } },
          {
            id: 'thresholds',
            value: {
              mode: 'absolute',
              steps: [
                { color: 'green', value: null },
                { color: 'yellow', value: 0.01 },
                { color: 'red', value: 0.05 },
              ],
            },
          },
        ],
      },
    ],
  },
}

test('buildTable merges targets on labels and applies organize + overrides', () => {
  const frames = [
    vectorFrame('A', { method: 'POST', route: '/mcp/v1', deployment_environment: 'prod' }, 1.65),
    vectorFrame('A', { method: 'GET', route: '/mcp/v1', deployment_environment: 'prod' }, 0.62),
    vectorFrame('B', { method: 'POST', route: '/mcp/v1', deployment_environment: 'prod' }, 0.02),
  ]
  const m = buildTable(frames, TABLE_PANEL)

  // deployment_environment is excluded; series merged per (method, route).
  assert.deepEqual(m.labelColumns, ['method', 'route'])
  assert.equal(m.rows.length, 2)

  assert.deepEqual(
    m.valueColumns.map((c) => c.title),
    ['req/s', 'error rate'],
  )
  assert.equal(m.valueColumns[0].unit, 'reqps')
  assert.equal(m.valueColumns[1].colorBackground, true)

  // Sorted by the first value column, descending; B lands on the same row as
  // its matching A series.
  assert.deepEqual(m.rows[0].labels, { method: 'POST', route: '/mcp/v1' })
  assert.equal(m.rows[0].values.A, 1.65)
  assert.equal(m.rows[0].values.B, 0.02)
  assert.equal(m.rows[1].values.B, undefined)
})

test('thresholdColor picks the highest step at or below the value', () => {
  const steps = [
    { color: 'green', value: null },
    { color: 'yellow', value: 0.01 },
    { color: 'red', value: 0.05 },
  ]

  assert.equal(thresholdColor(0.001, steps), '#73bf69')
  assert.equal(thresholdColor(0.02, steps), '#f2cc0c')
  assert.equal(thresholdColor(0.5, steps), '#fa6e6e')
  assert.equal(thresholdColor(null, steps), null)
})
