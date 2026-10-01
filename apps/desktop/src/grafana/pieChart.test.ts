import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizeFrame } from './model.ts'
import { buildPieSlices, pieOptions, pieSlicePath } from './pieChart.ts'

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

const panel = (options: Record<string, unknown> = {}): Panel => ({
  id: 1,
  type: 'piechart',
  title: 'Share',
  gridPos: { x: 0, y: 0, w: 12, h: 8 },
  targets: [{ refId: 'A', legendFormat: '{{pod}}' }],
  options,
})

test('slices cover the circle in query order, starting at 12 o’clock', () => {
  const slices = buildPieSlices(
    [vectorFrame({ pod: 'a' }, 30), vectorFrame({ pod: 'b' }, 10)],
    panel(),
  )

  assert.deepEqual(
    slices.map((slice) => [slice.label, slice.fraction]),
    [
      ['a', 0.75],
      ['b', 0.25],
    ],
  )
  assert.equal(slices[0]?.fromDeg, -90)
  assert.equal(slices[0]?.toDeg, 180)
  assert.equal(slices[1]?.toDeg, 270)
  assert.notEqual(slices[0]?.color, slices[1]?.color)
})

test('non-positive values have no arc, so they are left out', () => {
  assert.deepEqual(
    buildPieSlices([vectorFrame({ pod: 'a' }, 5), vectorFrame({ pod: 'b' }, -2)], panel()).map(
      (slice) => slice.label,
    ),
    ['a'],
  )
  assert.deepEqual(buildPieSlices([vectorFrame({ pod: 'a' }, 0)], panel()), [])
})

test('a lone series draws a full circle as two arcs', () => {
  const [slice] = buildPieSlices([vectorFrame({ pod: 'a' }, 7)], panel())

  assert.ok(slice)
  assert.equal(slice.fraction, 1)
  const path = pieSlicePath({ cx: 50, cy: 50, outer: 40, inner: 0 }, slice.fromDeg, slice.toDeg)

  // Two move commands: a single 360° arc would collapse to a point.
  assert.equal(path.match(/M/g)?.length, 2)
  assert.ok(!path.includes('NaN'))
})

test('a donut slice is an annulus, and options come off the panel', () => {
  const path = pieSlicePath({ cx: 50, cy: 50, outer: 40, inner: 24 }, -90, 0)

  assert.ok(path.includes('A40.00,40.00'))
  assert.ok(path.includes('A24.00,24.00'))

  assert.deepEqual(pieOptions(panel({ pieType: 'donut', displayLabels: ['percent'] })), {
    donut: true,
    legend: 'right',
    labels: { name: false, value: false, percent: true },
  })
  assert.equal(pieOptions(panel({ legend: { showLegend: false } })).legend, 'hidden')
  assert.equal(pieOptions(panel({ legend: { placement: 'bottom' } })).legend, 'bottom')
})
