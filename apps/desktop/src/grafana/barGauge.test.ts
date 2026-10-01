import assert from 'node:assert/strict'
import { test } from 'node:test'

import { barGaugeScale, buildBarGauge } from './barGauge.ts'
import { normalizeFrame } from './model.ts'

import type { Panel } from './types.ts'

function vectorFrame(labels: Record<string, string>, value: number) {
  return normalizeFrame(
    {
      schema: {
        refId: 'A',
        fields: [
          { name: 'Time', type: 'time' },
          { name: 'Value', type: 'number', labels },
        ],
      },
      data: { values: [[1783153139000], [value]] },
    },
    'A',
  )
}

type Defaults = NonNullable<NonNullable<Panel['fieldConfig']>['defaults']>

const panel = (defaults: Defaults = {}): Panel => ({
  id: 1,
  type: 'bargauge',
  title: 'Saturation',
  gridPos: { x: 0, y: 0, w: 12, h: 8 },
  targets: [{ refId: 'A', legendFormat: '{{pod}}' }],
  fieldConfig: { defaults },
})

test('an unset range scales to the data, floored at zero', () => {
  assert.deepEqual(barGaugeScale(panel(), [20, 60]), { min: 0, max: 60 })
  // Negative data keeps its own floor.
  assert.deepEqual(barGaugeScale(panel(), [-5, 10]), { min: -5, max: 10 })
  // A degenerate range still has a width, so a bar can be drawn.
  assert.deepEqual(barGaugeScale(panel(), [0]), { min: 0, max: 1 })
  assert.deepEqual(barGaugeScale(panel({ min: 10, max: 10 }), [10]), { min: 10, max: 11 })
})

test('bars fill against the configured range and clamp past it', () => {
  const bars = buildBarGauge(
    [vectorFrame({ pod: 'a' }, 25), vectorFrame({ pod: 'b' }, 120)],
    panel({ min: 0, max: 100, unit: 'percent' }),
    'percent',
  )

  assert.deepEqual(
    bars.map((bar) => [bar.label, bar.fraction, bar.text]),
    [
      ['a', 0.25, '25.00%'],
      ['b', 1, '120.00%'],
    ],
  )
})

test('thresholds colour the bar, with the base colour below the first step', () => {
  const thresholds = {
    min: 0,
    max: 100,
    thresholds: {
      steps: [
        { color: 'green', value: null },
        { color: 'red', value: 80 },
      ],
    },
  }
  const bars = buildBarGauge(
    [vectorFrame({ pod: 'a' }, 10), vectorFrame({ pod: 'b' }, 90)],
    panel(thresholds),
  )

  assert.equal(bars[0]?.color, '#73bf69')
  assert.equal(bars[1]?.color, '#fa6e6e')
})
