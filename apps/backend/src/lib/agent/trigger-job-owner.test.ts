import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'

import type { Job } from 'bullmq'

// A failed job's log line names the team and conversation that missed a run and
// when it was due (#4475), whichever kind of job it is.

const TRIGGER_ID = '6af1a38b843a609932e6f66d'
const triggerWrites: unknown[] = []

useDb({
  db: () => ({
    collection: (name: string) => ({
      // Logging a failure only reads; it never writes to the Trigger.
      findOneAndUpdate: async (_filter: unknown, update: unknown) => triggerWrites.push(update),
      updateOne: async (_filter: unknown, update: unknown) => triggerWrites.push(update),
      findOne: async () =>
        name === 'agent_task_reports'
          ? { teamId: 'team-r', parentSessionId: 'session-parent' }
          : { teamId: 'team-t', targetSessionId: 'session-t' },
    }),
  }),
})
useAgentDb({
  getConversationBySessionId: async (sessionId: string) => ({ sessionId, teamId: 'team-c' }),
})

const { whoseJob } = await import('./trigger-job-owner')

const job = (name: string, data: unknown, opts: Job['opts'] = {}) =>
  ({ name, data, timestamp: Date.parse('2026-11-22T08:00:00Z'), opts }) as Job

beforeEach(() => {
  triggerWrites.length = 0
})

test('a cron fire logs the slot it was scheduled for and its owner, without writing to the Trigger', async () => {
  const fire = job(
    'run-trigger',
    { triggerId: TRIGGER_ID },
    {
      prevMillis: Date.parse('2026-11-22T09:00:00Z'),
      delay: 5,
    },
  )

  expect(await whoseJob(fire)).toEqual({
    scheduled_at: '2026-11-22T09:00:00.000Z',
    trigger_id: TRIGGER_ID,
    team_id: 'team-t',
    session_id: 'session-t',
  })
  expect(triggerWrites).toEqual([])
})

test('a task report logs the team and the parent conversation it was delivered to', async () => {
  expect(await whoseJob(job('task-report', { reportId: 'r1' }, { delay: 60_000 }))).toEqual({
    scheduled_at: '2026-11-22T08:01:00.000Z',
    team_id: 'team-r',
    session_id: 'session-parent',
  })
})

test('a resource event turn logs its conversation and that conversation’s team', async () => {
  expect(await whoseJob(job('resource-session-turn', { sessionId: 's1' }))).toEqual({
    scheduled_at: '2026-11-22T08:00:00.000Z',
    team_id: 'team-c',
    session_id: 's1',
  })
  expect(triggerWrites).toEqual([])
})
