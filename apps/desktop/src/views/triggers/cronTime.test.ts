import assert from 'node:assert/strict'
import test from 'node:test'

import { formatUtcAndLocal, formatUtcRun, utcTimeOfDayInZone, zoneLabel } from './cronTime.ts'

const at = (iso: string) => new Date(iso)

test('a UTC instant is shown in UTC with the viewer clock beside it', () => {
  assert.equal(
    formatUtcAndLocal(at('2026-09-21T09:00:00Z'), 'Asia/Taipei'),
    '09:00 UTC (17:00 your time)',
  )
})

test('both sides carry a weekday when the local date differs', () => {
  assert.equal(
    formatUtcAndLocal(at('2026-09-21T01:00:00Z'), 'America/Los_Angeles'),
    'Mon 01:00 UTC (Sun 18:00 your time)',
  )
  assert.equal(
    formatUtcAndLocal(at('2026-09-20T23:00:00Z'), 'Asia/Taipei'),
    'Sun 23:00 UTC (Mon 07:00 your time)',
  )
})

test('a viewer on UTC gets no redundant local time', () => {
  assert.equal(formatUtcAndLocal(at('2026-09-21T09:00:00Z'), 'UTC'), '09:00 UTC')
})

test('half-hour offsets keep their minutes', () => {
  assert.equal(
    formatUtcAndLocal(at('2026-09-21T09:00:00Z'), 'Asia/Kolkata'),
    '09:00 UTC (14:30 your time)',
  )
})

test('a run is dated in UTC', () => {
  assert.equal(
    formatUtcRun(at('2026-09-20T23:00:00Z'), 'Asia/Taipei'),
    'Sun, Sep 20 · Sun 23:00 UTC (Mon 07:00 your time)',
  )
})

test('utcTimeOfDayInZone reports the day shift and follows DST', () => {
  const summer = at('2026-07-01T12:00:00Z')
  const winter = at('2026-12-01T12:00:00Z')

  assert.deepEqual(utcTimeOfDayInZone(1, 0, 'America/Los_Angeles', summer), {
    hm: '18:00',
    dayShift: -1,
  })
  assert.deepEqual(utcTimeOfDayInZone(1, 0, 'America/Los_Angeles', winter), {
    hm: '17:00',
    dayShift: -1,
  })
  assert.deepEqual(utcTimeOfDayInZone(20, 0, 'Asia/Taipei', summer), { hm: '04:00', dayShift: 1 })
  assert.deepEqual(utcTimeOfDayInZone(9, 0, 'Asia/Taipei', summer), { hm: '17:00', dayShift: 0 })
})

test('zoneLabel names the zone and its current offset', () => {
  assert.equal(zoneLabel('Asia/Taipei', at('2026-09-21T00:00:00Z')), 'Asia/Taipei, UTC+8')
  assert.equal(zoneLabel('Asia/Kolkata', at('2026-09-21T00:00:00Z')), 'Asia/Kolkata, UTC+5:30')
  assert.equal(zoneLabel('UTC', at('2026-09-21T00:00:00Z')), 'UTC')
})
