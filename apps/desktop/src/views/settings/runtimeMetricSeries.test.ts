import assert from 'node:assert/strict'
import { test } from 'node:test'

import { reportedSeries } from './runtimePresentation.ts'

import type { RuntimeMetricSample } from '../../types/runtime.ts'

const series = [
  { key: 'cpuMillicores' },
  { key: 'memoryBytes' },
  { key: 'diskUsedBytes' },
  { key: 'sessions' },
] as const

function sample(overrides: Partial<RuntimeMetricSample>): RuntimeMetricSample {
  return {
    at: '2026-09-25T00:00:00.000Z',
    cpuMillicores: null,
    memoryBytes: null,
    sessions: null,
    diskTotalBytes: null,
    diskUsedBytes: null,
    ...overrides,
  }
}

test('a runtime that predates usage reporting charts only its sessions', () => {
  const samples = [sample({ sessions: 1 }), sample({ sessions: 2 })]

  assert.deepEqual(
    reportedSeries(samples, series).map(({ key }) => key),
    ['sessions'],
  )
})

test('one reading anywhere in the window keeps a series', () => {
  const samples = [sample({ cpuMillicores: 12 }), sample({ memoryBytes: 1, diskUsedBytes: 0 })]

  assert.deepEqual(
    reportedSeries(samples, series).map(({ key }) => key),
    ['cpuMillicores', 'memoryBytes', 'diskUsedBytes'],
  )
})

test('nothing reported charts nothing', () => {
  assert.deepEqual(reportedSeries([sample({}), sample({})], series), [])
  assert.deepEqual(reportedSeries([], series), [])
})
