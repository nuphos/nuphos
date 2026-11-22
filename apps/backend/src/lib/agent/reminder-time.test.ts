import { describe, expect, test } from 'bun:test'

import { parseDueAt } from './reminder-time'

describe('parseDueAt', () => {
  test('takes an instant with Z or an offset as it is', () => {
    expect(parseDueAt('2026-11-21T09:00:00Z')?.toISOString()).toBe('2026-11-21T09:00:00.000Z')
    expect(parseDueAt('2026-11-21T09:00:00+01:00')?.toISOString()).toBe('2026-11-21T08:00:00.000Z')
  })

  test('reads a local time in its zone, across a clock change', () => {
    expect(parseDueAt('2026-11-21T09:00', 'Europe/Stockholm')?.toISOString()).toBe(
      '2026-11-21T08:00:00.000Z',
    )
    expect(parseDueAt('2026-07-21T09:00', 'Europe/Stockholm')?.toISOString()).toBe(
      '2026-07-21T07:00:00.000Z',
    )
    expect(parseDueAt('2026-11-21 09:00', 'Asia/Taipei')?.toISOString()).toBe(
      '2026-11-21T01:00:00.000Z',
    )
  })

  test('never guesses a zone or a date that does not exist', () => {
    expect(parseDueAt('2026-11-21T09:00')).toBeNull()
    expect(parseDueAt('2026-11-21T09:00', 'Mars/Base')).toBeNull()
    expect(parseDueAt('2026-02-30T09:00', 'UTC')).toBeNull()
    expect(parseDueAt('tomorrow', 'UTC')).toBeNull()
  })
})
