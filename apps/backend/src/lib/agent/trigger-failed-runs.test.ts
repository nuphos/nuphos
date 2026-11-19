import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { runtimeGone } from '@/lib/claude-code-preview/runtime-refusal'
import { AppError } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'

import { systemSender } from './message-metadata'
import { PAUSE_AFTER_FAILED_RUNS, recordFailedFires } from './trigger-failed-runs'
import { recordTriggerRan } from './trigger-missed-runs'

import type { AgentTrigger } from './trigger-db'
import type { TriggerRunDeps } from './trigger-missed-runs'

// A Trigger whose turns keep failing for a reason that cannot pass with time
// pauses itself after a few in a row and tells its owner why, in plain words.

const _id = new ObjectId()
const TRIGGER_ID = _id.toHexString()
let row: AgentTrigger
const alerts: { title: string; body: string }[] = []
const history: Record<string, unknown>[] = []

useDb({
  withTransaction: (body: (session: never) => Promise<void>) => body({} as never),
  db: () =>
    ({
      collection: () => ({
        insertOne: async (doc: Record<string, unknown>) => history.push(doc),
      }),
    }) as never,
})

const matches = (filter: Record<string, unknown>) =>
  String(filter._id) === TRIGGER_ID &&
  (filter.enabled === undefined || filter.enabled === row.enabled)

function apply(update: Record<string, Record<string, unknown>>) {
  const next = { ...row } as Record<string, unknown>

  for (const [key, value] of Object.entries(update.$set ?? {})) next[key] = value
  for (const key of Object.keys(update.$unset ?? {})) delete next[key]
  for (const [key, value] of Object.entries(update.$inc ?? {}))
    next[key] = ((next[key] as number | undefined) ?? 0) + (value as number)
  row = next as AgentTrigger
}

const deps = {
  triggers: {
    updateOne: async (
      filter: Record<string, unknown>,
      update: Record<string, Record<string, unknown>>,
    ) => {
      if (!matches(filter)) return { modifiedCount: 0 }
      apply(update)

      return { modifiedCount: 1 }
    },
    findOneAndUpdate: async (
      filter: Record<string, unknown>,
      update: Record<string, Record<string, unknown>>,
    ) => {
      if (!matches(filter)) return null
      apply(update)

      return row
    },
  },
  notify: (_userIds: string[], alert: { title: string; body: string }) => {
    alerts.push({ title: alert.title, body: alert.body })
  },
} as unknown as TriggerRunDeps

const fire = [
  {
    source: 'agent.resource',
    metadata: systemSender(`trigger:${TRIGGER_ID}`, 'Hourly report'),
    receivedAt: new Date().toISOString(),
  },
]
const tooLong = new Error('prompt is too long: 240000 tokens > 200000 maximum')
const outOfUsage = new Error('Gateway (status 402 Payment Required): out of credits')

beforeEach(() => {
  alerts.length = 0
  history.length = 0
  row = {
    _id,
    userId: 'owner',
    teamId: 'team',
    targetSessionId: 'task',
    name: 'Hourly report',
    triggerType: 'cron',
    cronExpression: '0 * * * *',
    messageTemplate: 'report',
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
})

test('fires that keep failing for a lasting reason pause the Trigger and tell its owner', async () => {
  for (let run = 1; run < PAUSE_AFTER_FAILED_RUNS; run++)
    await recordFailedFires(tooLong, fire, deps)
  expect(row.enabled).toBe(true)
  expect(alerts).toEqual([])

  await recordFailedFires(tooLong, fire, deps)
  expect(row.enabled).toBe(false)
  expect(row.executionAuthorizationError).toBe(
    'Paused after 3 runs in a row failed. This conversation is too long for the model. Start a new Task, or switch to a model with a larger context. Then turn the Trigger back on.',
  )
  expect(alerts).toEqual([
    { title: 'Trigger paused', body: `Hourly report: ${row.executionAuthorizationError}` },
  ])
  // Resuming starts the count over.
  expect(row.failedRunCount).toBeUndefined()
  // #3755: the pause is on the Trigger's record, with why.
  expect(history).toMatchObject([
    {
      action: 'updated',
      actorId: 'system',
      via: 'failed_runs',
      reason: row.executionAuthorizationError,
      before: { enabled: true },
      after: { enabled: false },
    },
  ])
})

test('a signed-out agent counts as a lasting failure', async () => {
  const signedOut = new AppError(409, 'runtime_login_required', 'Sign in')

  for (let run = 0; run < PAUSE_AFTER_FAILED_RUNS; run++)
    await recordFailedFires(signedOut, fire, deps)
  expect(row.enabled).toBe(false)
  expect(row.executionAuthorizationError).toContain('sign-in is no longer valid')
})

// #3718: failed before the turn, while resolving the agent, and never counted.
test('an agent that is gone counts as a lasting failure', async () => {
  for (let run = 0; run < PAUSE_AFTER_FAILED_RUNS; run++)
    await recordFailedFires(runtimeGone(), fire, deps)
  expect(row.enabled).toBe(false)
  expect(row.executionAuthorizationError).toContain('Move this conversation to another agent')
  expect(alerts).toEqual([
    { title: 'Trigger paused', body: `Hourly report: ${row.executionAuthorizationError}` },
  ])
})

test('a failure that passes with time never pauses the Trigger', async () => {
  for (let run = 0; run < PAUSE_AFTER_FAILED_RUNS * 2; run++)
    await recordFailedFires(outOfUsage, fire, deps)
  expect(row.enabled).toBe(true)
  expect(row.failedRunCount).toBeUndefined()
  expect(alerts).toEqual([])
})

test('a run that succeeds resets the count', async () => {
  for (let run = 1; run < PAUSE_AFTER_FAILED_RUNS; run++)
    await recordFailedFires(tooLong, fire, deps)
  await recordTriggerRan(TRIGGER_ID, deps)
  for (let run = 1; run < PAUSE_AFTER_FAILED_RUNS; run++)
    await recordFailedFires(tooLong, fire, deps)
  expect(row.enabled).toBe(true)
  expect(alerts).toEqual([])
})

test('a Box its plan will not start pauses the Trigger with the plan’s reason', async () => {
  const outOfHours = new AppError(
    402,
    'box_vcpu_limit',
    "Your team's free cloud computer has used its 50 hours this month.",
  )

  for (let run = 0; run < PAUSE_AFTER_FAILED_RUNS; run++)
    await recordFailedFires(outOfHours, fire, deps)
  expect(row.enabled).toBe(false)
  expect(row.executionAuthorizationError).toBe(
    "Paused after 3 runs in a row failed. Your team's free cloud computer has used its 50 hours this month. Then turn the Trigger back on.",
  )
})
