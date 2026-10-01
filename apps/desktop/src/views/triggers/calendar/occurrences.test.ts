import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildScheduleEvents,
  buildWebhookRunEvents,
  cronOccurrencesInRange,
  layoutDayEvents,
  nextOccurrencesAfter,
} from './occurrences.ts'

import type { AgentConversation, AgentTrigger } from '../../../api.ts'

const trigger = (overrides: Partial<AgentTrigger>): AgentTrigger =>
  ({
    id: 't1',
    userId: 'u1',
    name: 'Daily report',
    triggerType: 'cron',
    cronExpression: '0 9 * * *',
    messageTemplate: 'report',
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }) as AgentTrigger

test('expands a daily cron across a week, boundaries included at start only', () => {
  const start = new Date('2026-08-16T00:00:00Z')
  const end = new Date('2026-08-23T00:00:00Z')
  const runs = cronOccurrencesInRange('0 0 * * *', start, end)

  // Midnight fires: the 16th (exactly at range start) through the 22nd — the
  // 23rd is the exclusive end and stays out.
  assert.equal(runs.length, 7)
  assert.equal(runs[0].getTime(), start.getTime())
  assert.equal(runs[6].getUTCDate(), 22)
})

test('invalid expressions expand to nothing', () => {
  assert.deepEqual(cronOccurrencesInRange('not a cron', new Date(), new Date()), [])
})

test('buildScheduleEvents keeps cron triggers, flagging disabled ones', () => {
  const start = new Date('2026-08-17T00:00:00Z')
  const end = new Date('2026-08-18T00:00:00Z')
  const events = buildScheduleEvents(
    [
      trigger({ id: 'on' }),
      trigger({ id: 'off', enabled: false, cronExpression: '0 10 * * *' }),
      trigger({ id: 'hook', triggerType: 'webhook', cronExpression: undefined }),
    ],
    start,
    end,
  )

  assert.deepEqual(
    events.map((event) => ({ triggerId: event.triggerId, enabled: event.enabled })),
    [
      { triggerId: 'on', enabled: true },
      { triggerId: 'off', enabled: false },
    ],
  )
  assert.equal(events[0].start.getUTCHours(), 9)
})

test('cron expressions are expanded in UTC whatever the viewer zone', () => {
  const runs = cronOccurrencesInRange(
    '0 9 * * 1',
    new Date('2026-09-20T00:00:00Z'),
    new Date('2026-09-27T00:00:00Z'),
  )

  assert.deepEqual(
    runs.map((run) => run.toISOString()),
    ['2026-09-21T09:00:00.000Z'],
  )
  assert.equal(
    nextOccurrencesAfter('30 23 * * *', new Date('2026-09-21T00:00:00Z'), 1)[0].toISOString(),
    '2026-09-21T23:30:00.000Z',
  )
})

test('nextOccurrencesAfter returns the runs strictly after the given time', () => {
  const after = new Date('2026-08-20T09:00:00Z')
  const next = nextOccurrencesAfter('0 9 * * *', after, 2)

  assert.equal(next.length, 2)
  assert.equal(next[0].getUTCDate(), 21)
  assert.equal(next[1].getUTCDate(), 22)
})

test('buildWebhookRunEvents places received webhook runs, always solid', () => {
  const conversations = [
    {
      sessionId: 's1',
      createdAt: '2026-08-19T02:30:00Z',
      triggerRun: { id: 'hook', kind: 'webhook' },
    },
    // A cron trigger's run — not a webhook event, stays off the overlay.
    { sessionId: 's2', createdAt: '2026-08-19T03:00:00Z', triggerRun: { id: 'cron' } },
    { sessionId: 's3', createdAt: 'not a date', triggerRun: { id: 'hook' } },
  ] as AgentConversation[]
  const events = buildWebhookRunEvents(
    [
      trigger({ id: 'hook', triggerType: 'webhook', cronExpression: undefined, enabled: false }),
      trigger({ id: 'cron' }),
    ],
    conversations,
  )

  assert.deepEqual(
    events.map((event) => ({ key: event.key, kind: event.kind, enabled: event.enabled })),
    [{ key: 'run:s1', kind: 'webhook', enabled: true }],
  )
})

const at = (hour: number, minute: number, id: string) => ({
  key: `${id}@${String(hour)}:${String(minute)}`,
  triggerId: id,
  name: id,
  start: new Date(2026, 7, 20, hour, minute),
  enabled: true,
  kind: 'cron' as const,
})

test('lane layout splits overlapping chips and leaves separate ones full-width', () => {
  const positioned = layoutDayEvents([at(9, 0, 'a'), at(9, 15, 'b'), at(14, 0, 'c')])

  assert.deepEqual(
    positioned.map((p) => ({ lane: p.lane, laneCount: p.laneCount })),
    [
      { lane: 0, laneCount: 2 },
      { lane: 1, laneCount: 2 },
      { lane: 0, laneCount: 1 },
    ],
  )
})
