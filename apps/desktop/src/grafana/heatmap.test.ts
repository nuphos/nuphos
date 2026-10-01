import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildHeatmap } from './heatmap.ts'
import { normalizeFrame } from './model.ts'

// Run with: pnpm test  (node --experimental-strip-types --test; Node >= 22.6)

// Shaped like the real /api/ds/query response for a `format: "heatmap"`
// Prometheus range query: one frame per cumulative `le` bucket.
function leFrame(le: string, times: number[], values: number[]) {
  return normalizeFrame(
    {
      schema: {
        refId: 'A',
        fields: [
          { name: 'Time', type: 'time' },
          { name: 'Value', type: 'number', labels: { le } },
        ],
      },
      data: { values: [times, values] },
    },
    'A',
  )
}

test('buildHeatmap de-accumulates cumulative le buckets', () => {
  const t = [1000, 2000]
  const frames = [leFrame('+Inf', t, [10, 12]), leFrame('10', t, [7, 8]), leFrame('0', t, [2, 2])]
  const m = buildHeatmap(frames)

  assert.ok(m)
  // Buckets sorted ascending, +Inf last.
  assert.deepEqual(m.buckets, [0, 10, Infinity])
  assert.deepEqual(m.times, t)
  // Exclusive counts: le=0 keeps its own, le=10 minus le=0, +Inf minus le=10.
  assert.deepEqual(m.cells[0], [2, 2])
  assert.deepEqual(m.cells[1], [5, 6])
  assert.deepEqual(m.cells[2], [3, 4])
  assert.equal(m.max, 6)
})

test('buildHeatmap clamps negative diffs and ignores non-le series', () => {
  const t = [1000]
  const frames = [
    leFrame('10', t, [1]),
    leFrame('+Inf', t, [0.5]), // counter reset artifact → clamp to 0
    leFrame('not-a-bucket', t, [99]),
  ]
  const m = buildHeatmap(frames)

  assert.ok(m)
  assert.deepEqual(m.buckets, [10, Infinity])
  assert.deepEqual(m.cells[1], [0])
})

test('buildHeatmap returns null with no bucket series', () => {
  assert.equal(buildHeatmap([]), null)
})
