import assert from 'node:assert/strict'
import test from 'node:test'

import { nextOccurrencesAfter } from './calendar/occurrences.ts'
import { formatViewerRun, userScheduleSummary } from './scheduleDisplay.ts'

const trigger = (cronExpression: string, timeZone = 'UTC') => ({
  triggerType: 'cron' as const,
  cronExpression,
  timeZone,
})
const now = new Date('2026-01-15T00:00:00Z')

test('UTC monthly schedules show exact Taipei dates first', () => {
  const text = userScheduleSummary(trigger('0 1 1 * *'), 'Asia/Taipei', now)

  assert.match(text, /^Scheduled: 2\/1\/2026, 9:00 AM \(Asia\/Taipei, UTC\+8\)/)
  assert.doesNotMatch(text, /3\/1\/2026/)
  assert.doesNotMatch(text, /Source rule:/)
})

const allTimes = (value: ReturnType<typeof trigger>, zone: string, at: Date) =>
  Array.from({ length: 3 }, () => {
    const text = userScheduleSummary(value, zone, at)
    const [next] = nextOccurrencesAfter(value.cronExpression, at, 1, value.timeZone)

    at = next

    return text
  }).join('; ')

test('negative offsets cross month and year boundaries without inventing day 1', () => {
  const text = allTimes(trigger('0 1 1 * *'), 'America/New_York', new Date('2025-12-15T00:00Z'))

  assert.match(text, /12\/31\/2025, 8:00 PM/)
  assert.match(text, /1\/31\/2026, 8:00 PM/)
  assert.match(text, /2\/28\/2026, 8:00 PM/)
})

test('weekly midnight crossings use the actual previous local day', () => {
  const text = userScheduleSummary(
    trigger('0 1 * * 1'),
    'America/New_York',
    new Date('2026-01-16T00:00Z'),
  )

  assert.match(text, /1\/18\/2026, 8:00 PM/)
})

test('UTC recurrence remains UTC across a viewer DST transition', () => {
  const text = allTimes(trigger('0 9 * * *'), 'America/Los_Angeles', new Date('2026-03-07T00:00Z'))

  assert.match(text, /3\/7\/2026, 1:00 AM \(America\/Los_Angeles, UTC-8\)/)
  assert.match(text, /3\/9\/2026, 2:00 AM \(America\/Los_Angeles, UTC-7\)/)
})

test('non-UTC source schedules are evaluated in their own DST zone', () => {
  const text = allTimes(
    trigger('0 9 * * *', 'America/New_York'),
    'Asia/Taipei',
    new Date('2026-03-07T00:00Z'),
  )

  assert.match(text, /3\/7\/2026, 10:00 PM/)
  assert.match(text, /3\/8\/2026, 9:00 PM/)
})

test('month-end skips and leap years come from the actual scheduler parser', () => {
  assert.deepEqual(
    nextOccurrencesAfter('0 1 31 * *', now, 3).map((d) => d.toISOString()),
    ['2026-01-31T01:00:00.000Z', '2026-03-31T01:00:00.000Z', '2026-05-31T01:00:00.000Z'],
  )
  assert.equal(
    nextOccurrencesAfter('0 1 29 2 *', now, 1)[0].toISOString(),
    '2028-02-29T01:00:00.000Z',
  )
})

test('unsupported description syntax still gets exact dates; invalid syntax preserves fallback', () => {
  assert.match(
    userScheduleSummary(trigger('0 1 1 * 1'), 'Asia/Kolkata', now),
    /Asia\/Kolkata, UTC\+5:30/,
  )
  assert.equal(
    userScheduleSummary(trigger('nonsense'), 'Asia/Taipei', now),
    'Runs on schedule nonsense (UTC)',
  )
  assert.equal(
    userScheduleSummary({ triggerType: 'webhook' }),
    'Runs when its webhook receives a request',
  )
})

test('run labels use the selected viewing zone and never the process date', () => {
  assert.equal(
    formatViewerRun(new Date('2026-01-01T01:00Z'), 'America/New_York'),
    '12/31/2025, 8:00 PM (America/New_York, UTC-5)',
  )
})

test('paused triggers show status and rule without suggesting future execution', () => {
  const paused = { ...trigger('0 1 1 * *'), enabled: false }
  const text = userScheduleSummary(paused, 'Asia/Taipei', now)

  assert.match(text, /^Paused · /)
  assert.doesNotMatch(text, /Scheduled:|2\/1\/2026/)
  assert.match(
    userScheduleSummary(trigger('0 1 1 * *'), 'Asia/Taipei', now),
    /^Scheduled:/,
    'unsaved previews still show their next occurrence',
  )
})

test('frequent recurrences remain visible alongside the exact local next time', () => {
  for (const [expression, recurrence] of [
    ['* * * * *', 'Every minute'],
    ['*/5 * * * *', 'Every 5 minutes'],
    ['0 * * * *', 'Runs every hour at minute 00'],
    ['15 */2 * * *', 'Runs every 2 hours at minute 15, from 00:15 UTC'],
    ['0 9,17 * * *', 'Runs on schedule 0 9,17 * * * (UTC)'],
  ]) {
    const text = userScheduleSummary(trigger(expression), 'Asia/Taipei', now)

    assert.ok(text.startsWith(`${recurrence} · Scheduled:`), text)
    assert.match(text, /Asia\/Taipei, UTC\+8/)
  }
  assert.match(
    userScheduleSummary(trigger('*/7 * * * *'), 'UTC', now),
    /^Runs on schedule \*\/7/,
    'non-divisor steps must not claim a uniform interval',
  )
})

test('compact run labels omit repeated zone names but retain each DST offset', () => {
  assert.equal(
    formatViewerRun(new Date('2026-03-07T09:00Z'), 'America/Los_Angeles', false),
    '3/7/2026, 1:00 AM (UTC-8)',
  )
  assert.equal(
    formatViewerRun(new Date('2026-03-09T09:00Z'), 'America/Los_Angeles', false),
    '3/9/2026, 2:00 AM (UTC-7)',
  )
})
