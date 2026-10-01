import assert from 'node:assert/strict'
import { test } from 'node:test'

import { grafanaTimeSeriesConfig } from './grafanaTimeSeries.ts'
import { areaPointsForAxis } from './timeSeriesDisplay.ts'

import type { Panel } from './types.ts'

test('preserves Grafana axis, fill, gradient, line, stacking, and legend settings', () => {
  const panel = {
    fieldConfig: {
      defaults: {
        min: 0,
        max: 100,
        custom: {
          drawStyle: 'line',
          fillOpacity: 50,
          gradientMode: 'opacity',
          lineWidth: 1,
          stacking: { group: 'memory', mode: 'normal' },
        },
      },
    },
    options: { legend: { showLegend: false } },
  } as Panel

  assert.deepEqual(grafanaTimeSeriesConfig(panel), {
    style: {
      drawStyle: 'area',
      fillOpacity: 0.5,
      gradientMode: 'opacity',
      lineWidth: 1,
      stack: 'memory',
    },
    min: 0,
    max: 100,
    centeredZero: false,
    showLegend: false,
  })
})

test('preserves Grafana centered-zero axes', () => {
  const panel = {
    fieldConfig: { defaults: { custom: { axisCenteredZero: true } } },
  } as Panel

  assert.equal(grafanaTimeSeriesConfig(panel).centeredZero, true)
})

test('unstacked areas fill down to the visible y-axis minimum', () => {
  const points = [{ time: 1, value: -10, base: 0, top: -10 }]

  assert.deepEqual(areaPointsForAxis(points, -20, false), [
    { time: 1, value: -10, base: -20, top: -10 },
  ])
  assert.equal(areaPointsForAxis(points, -20, true), points)
})
