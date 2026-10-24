import assert from 'node:assert/strict'
import { test } from 'node:test'

import { deskReadings } from './boxMetricsPresentation.ts'

const GIB = 1024 ** 3
const sample = {
  sampledAt: '2026-10-23T20:00:00.000Z',
  cpuPercent: 16.4,
  memory: { used: 12.6 * GIB, total: 16 * GIB },
  disk: { used: 250 * GIB, total: 500 * GIB },
}

test('a live reading fills every gauge, with what memory and disk hold', () => {
  const readings = deskReadings(sample, 'live')

  assert.equal(readings.status, 'Live')
  assert.equal(readings.tone, 'live')
  assert.deepEqual(
    readings.gauges.map(({ label, value, detail }) => [label, value, detail]),
    [
      ['CPU', '16%', null],
      ['Memory', '79%', '12.6 of 16 GB'],
      ['Disk', '50%', '250 of 500 GB'],
    ],
  )
})

test('a stale reading still shows its numbers, marked stale', () => {
  const readings = deskReadings(sample, 'stale')

  assert.equal(readings.status, 'Stale reading')
  assert.equal(readings.tone, 'stale')
  assert.equal(readings.gauges[0]?.percent, 16.4)
})

test('a machine without a current reading shows empty gauges, never old numbers', () => {
  for (const status of ['offline', 'creating', 'connecting', 'unsupported', 'waiting'] as const) {
    const readings = deskReadings(sample, status)

    assert.equal(readings.tone, 'idle', status)
    assert.ok(
      readings.gauges.every((g) => g.percent === null && g.value === '—'),
      status,
    )
  }
})

test('live without a usable reading waits rather than claiming to be live', () => {
  assert.equal(deskReadings(null, 'live').status, 'Waiting for metrics')
  assert.equal(deskReadings({ ...sample, cpuPercent: 140 }, 'live').tone, 'idle')
  assert.equal(deskReadings(undefined).status, 'Waiting for metrics')
})
