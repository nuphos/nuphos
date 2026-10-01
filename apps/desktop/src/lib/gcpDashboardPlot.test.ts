import assert from 'node:assert/strict'
import { test } from 'node:test'

import { layoutTimeSeries } from '../grafana/timeSeriesDisplay.ts'

import { gcpFrameTimeSeriesStyle, gcpTimeSeriesStyle } from './gcpDashboardPlot.ts'

test('gcpTimeSeriesStyle preserves Cloud Monitoring XY presentation', () => {
  assert.deepEqual(gcpTimeSeriesStyle('LINE'), { drawStyle: 'line' })
  assert.deepEqual(gcpTimeSeriesStyle('STACKED_AREA'), {
    drawStyle: 'area',
    stack: 'gcp-widget',
  })
  assert.deepEqual(gcpTimeSeriesStyle('STACKED_BAR'), {
    drawStyle: 'bar',
    stack: 'gcp-widget',
  })
  assert.deepEqual(gcpTimeSeriesStyle('PLOT_TYPE_UNSPECIFIED'), { drawStyle: 'line' })
})

test('gcpFrameTimeSeriesStyle uses the saved dataset index after unsupported queries are skipped', () => {
  const queries = [
    { index: 0, plotType: 'LINE' },
    { index: 1, plotType: 'STACKED_AREA' },
  ]

  assert.deepEqual(gcpFrameTimeSeriesStyle('q1s0', queries), {
    drawStyle: 'area',
    stack: 'gcp-widget',
  })
})

test('layoutTimeSeries stacks area series at matching timestamps', () => {
  const laidOut = layoutTimeSeries([
    {
      points: [
        [1000, 2],
        [2000, 3],
      ] as [number, number | null][],
      style: gcpTimeSeriesStyle('STACKED_AREA'),
    },
    {
      points: [
        [1000, 5],
        [2000, 7],
      ] as [number, number | null][],
      style: gcpTimeSeriesStyle('STACKED_AREA'),
    },
  ])

  assert.deepEqual(
    laidOut.map((series) => series.renderPoints.map(({ base, top }) => [base, top])),
    [
      [
        [0, 2],
        [0, 3],
      ],
      [
        [2, 7],
        [3, 10],
      ],
    ],
  )
})

test('layoutTimeSeries keeps positive and negative stacks independent', () => {
  const style = gcpTimeSeriesStyle('STACKED_BAR')
  const laidOut = layoutTimeSeries([
    { points: [[1000, 4]], style },
    { points: [[1000, -2]], style },
    { points: [[1000, 3]], style },
    { points: [[1000, -1]], style },
  ])

  assert.deepEqual(
    laidOut.map((series) => {
      const point = series.renderPoints[0]

      return [point.base, point.top]
    }),
    [
      [0, 4],
      [0, -2],
      [4, 7],
      [-2, -3],
    ],
  )
})
