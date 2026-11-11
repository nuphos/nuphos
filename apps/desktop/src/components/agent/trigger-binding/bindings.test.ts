import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  allPaused,
  bindingsBySession,
  clockTooltipLines,
  lastRunState,
  nextRunOf,
  runClock,
  scheduledNote,
  shortSchedule,
  sortForSchedule,
  triggersForSessions,
} from './bindings.ts'

import type { AgentTrigger } from '../../../api/agent-trigger-types'

const NOW = new Date('2026-11-11T08:40:00Z')
const TPE = 'Asia/Taipei'

function trigger(patch: Partial<AgentTrigger>): AgentTrigger {
  return {
    id: 'tr1',
    userId: 'u1',
    name: 'Hourly check',
    triggerType: 'cron',
    cronExpression: '0 * * * *',
    messageTemplate: 'check',
    enabled: true,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...patch,
  }
}

test('triggers group by the conversation they deliver into', () => {
  const map = bindingsBySession([
    trigger({ id: 'a', name: 'B', targetSessionId: 's1', enabled: false }),
    trigger({ id: 'b', name: 'A', targetSessionId: 's1' }),
    trigger({ id: 'c', targetSessionId: 's2' }),
    trigger({ id: 'd' }),
    trigger({ id: 'e', targetSessionId: 's3', cleanupStatus: 'deleting' }),
  ])

  assert.deepEqual([...map.keys()].sort(), ['s1', 's2'])
  // Running ones first, then by name.
  assert.deepEqual(
    map.get('s1')?.map((item) => item.id),
    ['b', 'a'],
  )
})

test('a Bot chat gathers its own and its Bot Task triggers, once each', () => {
  const map = bindingsBySession([
    trigger({ id: 'a', targetSessionId: 'chat' }),
    trigger({ id: 'b', targetSessionId: 'bot' }),
  ])

  assert.deepEqual(
    triggersForSessions(map, ['chat', 'bot', undefined, 'chat']).map((item) => item.id),
    ['a', 'b'],
  )
  assert.deepEqual(triggersForSessions(map, ['nobody']), [])
})

test('next run is the next cron fire; paused and webhook triggers have none', () => {
  assert.equal(nextRunOf(trigger({}), NOW)?.toISOString(), '2026-11-11T09:00:00.000Z')
  assert.equal(nextRunOf(trigger({ enabled: false }), NOW), null)
  assert.equal(nextRunOf(trigger({ triggerType: 'webhook', cronExpression: undefined }), NOW), null)
})

test('last run state reads what the trigger records', () => {
  assert.equal(lastRunState(trigger({})), 'never')
  assert.equal(lastRunState(trigger({ lastRunAt: '2026-11-11T08:00:00Z' })), 'ok')
  assert.equal(
    lastRunState(
      trigger({ lastRunAt: '2026-11-11T08:00:00Z', executionAuthorizationStatus: 'invalid' }),
    ),
    'failed',
  )
})

test('a Scheduled row ends with its next run, or Paused', () => {
  assert.equal(scheduledNote(trigger({}), NOW, TPE, 'en-US'), 'next 17:00')
  assert.equal(
    scheduledNote(trigger({ cronExpression: '0 1 * * 1' }), NOW, TPE, 'en-US'),
    'next Mon 09:00',
  )
  assert.equal(scheduledNote(trigger({ enabled: false }), NOW, TPE, 'en-US'), 'Paused')
  assert.equal(
    scheduledNote(trigger({ triggerType: 'webhook', cronExpression: undefined }), NOW, TPE),
    '',
  )
})

test('short schedules use the viewer clock', () => {
  assert.equal(shortSchedule(trigger({}), TPE, NOW), 'Every hour')
  // 01:00 UTC is 09:00 the same day in Taipei.
  assert.equal(
    shortSchedule(trigger({ cronExpression: '0 1 * * 1-5' }), TPE, NOW),
    'Weekdays at 09:00',
  )
  // 20:00 UTC Sunday is 04:00 Monday in Taipei.
  assert.equal(shortSchedule(trigger({ cronExpression: '0 20 * * 0' }), TPE, NOW), 'Mon at 04:00')
  assert.equal(shortSchedule(trigger({ triggerType: 'webhook' }), TPE, NOW), 'Webhook')
})

test('run times show the day only when it is not today', () => {
  assert.equal(runClock(new Date('2026-11-11T09:00:00Z'), NOW, TPE, 'en-US'), '17:00')
  assert.equal(runClock(new Date('2026-11-12T09:00:00Z'), NOW, TPE, 'en-US'), 'Thu 17:00')
})

test('the Scheduled section lists the soonest first, then webhooks, then paused ones', () => {
  const daily = trigger({ id: 'daily', cronExpression: '0 1 * * *' })
  const hourly = trigger({ id: 'hourly' })
  const hook = trigger({ id: 'hook', triggerType: 'webhook', cronExpression: undefined })
  const paused = trigger({ id: 'paused', enabled: false })
  const input = [paused, daily, hook, hourly]

  assert.deepEqual(
    sortForSchedule(input, NOW).map((item) => item.id),
    ['hourly', 'daily', 'hook', 'paused'],
  )
  // The caller's list is left as it was.
  assert.equal(input[0]?.id, 'paused')
})

test('the sidebar tooltip names each trigger and the mark fades when all are paused', () => {
  const paused = trigger({ id: 'p', name: 'Nightly', enabled: false, cronExpression: '0 1 * * *' })

  assert.deepEqual(clockTooltipLines([trigger({}), paused], NOW, TPE, 'en-US'), [
    'Hourly check · Every hour · next 17:00',
    'Nightly · Every day at 09:00 · Paused',
  ])
  assert.equal(allPaused([paused]), true)
  assert.equal(allPaused([paused, trigger({})]), false)
  assert.equal(allPaused([]), false)
})
