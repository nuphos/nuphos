import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  deskReadings,
  diskWarning,
  memoryWarning,
  offlineFromPressure,
  pressureStatus,
} from './boxMetricsPresentation.ts'

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

const full = (used: number, status: 'live' | 'stale' | 'offline' = 'live') => ({
  label: 'Build Box',
  metricsStatus: status,
  metrics: { ...sample, disk: { used: used * GIB, total: 100 * GIB } },
})

test('a disk warns from 90% full, with what is left', () => {
  assert.equal(diskWarning(full(89.9)), null)
  assert.deepEqual(diskWarning(full(90)), { percent: 90, text: 'Disk almost full: 10 GB free' })
  assert.deepEqual(diskWarning(full(92.6)), { percent: 93, text: 'Disk almost full: 7.4 GB free' })
})

test('only a live reading warns: an old number says nothing about the disk now', () => {
  assert.equal(diskWarning(full(95, 'stale')), null)
  assert.equal(diskWarning(full(95, 'offline')), null)
  assert.equal(diskWarning({ metricsStatus: 'live', metrics: null }), null)
  assert.equal(diskWarning(undefined), null)
  // A reading that is not a reading (HMR, an older route) never warns.
  assert.equal(
    diskWarning({ metricsStatus: 'live', metrics: { ...sample, disk: { used: 95, total: 0 } } }),
    null,
  )
})

test('a recent OOM kill on the host says a process was stopped for memory, and what to do', () => {
  const now = Date.parse('2026-11-21T09:00:00.000Z')
  const killed = { ...sample, oomKilledAt: '2026-11-21T08:09:00.000Z' }
  const warning = memoryWarning({ metricsStatus: 'live', metrics: killed }, now)

  assert.equal(
    warning?.text,
    'In the last day, the system stopped a process because memory ran low',
  )
  assert.match(warning?.hint ?? '', /Run fewer Bots, Tasks, builds or browsers at once/u)
  assert.ok(memoryWarning({ metricsStatus: 'stale', metrics: killed }, now))
})

test('no OOM kill, an old one, or no current reading says nothing about memory', () => {
  const now = Date.parse('2026-11-21T09:00:00.000Z')
  const old = { ...sample, oomKilledAt: '2026-11-20T08:00:00.000Z' }
  const killed = { ...sample, oomKilledAt: '2026-11-21T08:09:00.000Z' }

  assert.equal(memoryWarning({ metricsStatus: 'live', metrics: sample }, now), null)
  assert.equal(memoryWarning({ metricsStatus: 'live', metrics: old }, now), null)
  assert.equal(memoryWarning({ metricsStatus: 'offline', metrics: killed }, now), null)
  assert.equal(memoryWarning(undefined, now), null)
})

test('a Box that just ran out of CPU or memory says so in its status, with what to do on hover', () => {
  const now = Date.parse('2026-11-24T01:00:00Z')
  const status = pressureStatus({ box: { pressureAt: '2026-11-24T00:50:00Z' } }, now)

  assert.equal(status?.label, 'Out of CPU or memory')
  assert.match(status?.hint ?? '', /Restart it, then run top in its terminal/u)
})

test('no note, or one from long enough ago, leaves the status alone', () => {
  const now = Date.parse('2026-11-24T01:00:00Z')

  assert.equal(pressureStatus({ box: {} }, now), null)
  assert.equal(pressureStatus({ box: { pressureAt: '2026-11-24T00:30:00Z' } }, now), null)
  assert.equal(pressureStatus(undefined, now), null)
})

test('an offline Box is said to be out of CPU or memory only right after it ran out', () => {
  const now = Date.parse('2026-11-24T01:00:00Z')

  assert.equal(offlineFromPressure({ box: { pressureAt: '2026-11-24T00:50:00Z' } }, now), true)
  assert.equal(offlineFromPressure({ box: { pressureAt: '2026-11-24T00:30:00Z' } }, now), false)
  assert.equal(offlineFromPressure({ box: {} }, now), false)
})
