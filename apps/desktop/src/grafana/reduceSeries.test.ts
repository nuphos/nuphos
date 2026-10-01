import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizeFrame } from './model.ts'
import { reduceSeries } from './reduceSeries.ts'

import type { Panel } from './types.ts'

function seriesFrame(refId: string, labels: Record<string, string>, values: (number | null)[]) {
  const times = values.map((_, index) => 1783153139000 + index * 15000)

  return normalizeFrame(
    {
      schema: {
        refId,
        fields: [
          { name: 'Time', type: 'time' },
          { name: 'Value', type: 'number', labels },
        ],
      },
      data: { values: [times, values] },
    },
    refId,
  )
}

/** A SQL-shaped frame: one string column of names beside the numbers. */
function tableFrame(names: string[], values: number[]) {
  return normalizeFrame(
    {
      schema: {
        refId: 'A',
        fields: [
          { name: 'service', type: 'string' },
          { name: 'requests', type: 'number' },
        ],
      },
      data: { values: [names, values] },
    },
    'A',
  )
}

const panel = (options: Record<string, unknown>, legendFormat?: string): Panel => ({
  id: 1,
  type: 'piechart',
  title: 'Share',
  gridPos: { x: 0, y: 0, w: 12, h: 8 },
  targets: [{ refId: 'A', ...(legendFormat ? { legendFormat } : {}) }],
  options,
})

test('reduces one value per series, labelled by the legend format', () => {
  const frames = [
    seriesFrame('A', { pod: 'api-1' }, [1, 2, 3]),
    seriesFrame('A', { pod: 'api-2' }, [10, null, 20]),
  ]

  assert.deepEqual(reduceSeries(frames, panel({}, '{{pod}}')), [
    { label: 'api-1', value: 3 },
    { label: 'api-2', value: 20 },
  ])
})

test('honours the calc reduceOptions asks for', () => {
  const frames = [seriesFrame('A', { pod: 'api-1' }, [2, 4, 6])]
  const calcOf = (calc: string) =>
    reduceSeries(frames, panel({ reduceOptions: { calcs: [calc] } }, '{{pod}}'))[0]?.value

  assert.equal(calcOf('mean'), 4)
  assert.equal(calcOf('sum'), 12)
  assert.equal(calcOf('min'), 2)
  assert.equal(calcOf('max'), 6)
  assert.equal(calcOf('first'), 2)
  assert.equal(calcOf('count'), 3)
  assert.equal(calcOf('range'), 4)
  // An unknown calc falls back to the default rather than rendering nothing.
  assert.equal(calcOf('nonsense'), 6)
})

test('a series with no finite value is dropped, not read as zero', () => {
  const frames = [
    seriesFrame('A', { pod: 'api-1' }, [null, null]),
    seriesFrame('A', { pod: 'api-2' }, [5]),
  ]

  assert.deepEqual(reduceSeries(frames, panel({}, '{{pod}}')), [{ label: 'api-2', value: 5 }])
})

test('values: true lists every row, labelled by the string column', () => {
  const frames = [tableFrame(['checkout', 'search'], [7, 3])]

  assert.deepEqual(reduceSeries(frames, panel({ reduceOptions: { values: true } })), [
    { label: 'checkout', value: 7 },
    { label: 'search', value: 3 },
  ])
})

test('the reduceOptions limit caps the series shown', () => {
  const frames = [
    seriesFrame('A', { pod: 'api-1' }, [1]),
    seriesFrame('A', { pod: 'api-2' }, [2]),
    seriesFrame('A', { pod: 'api-3' }, [3]),
  ]
  const limited = reduceSeries(frames, panel({ reduceOptions: { limit: 2 } }, '{{pod}}'))

  assert.deepEqual(
    limited.map((item) => item.label),
    ['api-1', 'api-2'],
  )
})
