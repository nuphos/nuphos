import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useThreadQueue } from '@/lib/test/doubles/thread-queue'
import { FakeCoordinationStore } from '@/lib/test/fake-coordination-store'

import { enqueueReport } from './task-report-queue'
import { deliverTaskReport } from './task-report-delivery'
import { recoverTaskReports, reportTask } from './task-reports'

const store = new FakeCoordinationStore()
let member = true
let queueFails = false
const queued: string[] = []
const jobs = new Map<string, { state: string; attemptsMade: number; retries: number }>()
const fakeQueue = {
  getJob: async (id: string) => {
    const job = jobs.get(id)

    return job
      ? {
          getState: async () => job.state,
          retry: async (_state: 'failed', options: { resetAttemptsMade: boolean }) => {
            if (job.state !== 'failed') throw new Error('not failed')
            job.state = 'waiting'
            if (options.resetAttemptsMade) job.attemptsMade = 0
            job.retries++
          },
        }
      : undefined
  },
  add: async (_name: string, _data: { reportId: string }, options: { jobId?: string }) => {
    const id = options.jobId!

    // BullMQ ignores duplicate IDs, even when the retained job has failed.
    if (!jobs.has(id)) jobs.set(id, { state: 'waiting', attemptsMade: 0, retries: 0 })
  },
}
const deliveries: { id: string; metadata: unknown }[] = []

useDb({ db: () => ({ collection: store.collection }) })
useAgentDb({
  getConversationBySessionId: async (id) =>
    store.rows.agent_conversations?.find((row) => row.sessionId === id) ?? null,
})
useIdentity({ getTeamMembership: async () => (member ? { role: 'MEMBER' } : null) })
useThreadQueue({
  enqueueTaskReport: async (id) => {
    if (queueFails) throw new Error('queue offline')
    queued.push(id)
    await enqueueReport(fakeQueue, id)
  },
})
useConversationTurn({
  executeConversationTurn: async (data, _target, _text, _source, metadata) => {
    deliveries.push({ id: data.messageId, metadata })
  },
})

beforeEach(() => {
  member = true
  queueFails = false
  queued.length = 0
  jobs.clear()
  deliveries.length = 0
  store.rows = {
    agent_conversations: [
      { sessionId: 'parent', title: 'Coordinator', userId: 'u', teamId: 't' },
      { sessionId: 'child', title: 'Worker', userId: 'u', teamId: 't', parentSessionId: 'parent' },
    ],
  }
})

const update = (reportId = 'ready-1', summary = 'Tests passed; PR awaits review.') =>
  reportTask('u', 't', 'child', { reportId, status: 'ready', summary })

test('report retries keep one immutable record and one delivery identity', async () => {
  await update()
  await update()
  expect(store.rows.agent_task_reports).toHaveLength(1)
  expect(queued[0]).toBe(queued[1])
  await deliverTaskReport(queued[0]!)
  await deliverTaskReport(queued[0]!)
  expect(deliveries).toHaveLength(1)
  expect(deliveries[0]?.metadata).toMatchObject({
    sender: { type: 'agent', id: 'child' },
    source: 'agent.thread',
  })
  await expect(update('ready-1', 'Changed payload')).rejects.toThrow('cannot be reused')
})

test('a report survives a queue outage and is recovered from the outbox', async () => {
  queueFails = true
  await expect(update()).rejects.toThrow('queue offline')
  expect(store.rows.agent_task_reports).toHaveLength(1)
  queueFails = false
  await recoverTaskReports()
  expect(queued).toHaveLength(1)
})

test('delivery rechecks parent, owner, team, membership and archive state', async () => {
  const edits = [
    () => {
      store.rows.agent_conversations![1]!.parentSessionId = 'elsewhere'
    },
    () => {
      store.rows.agent_conversations![0]!.userId = 'v'
    },
    () => {
      store.rows.agent_conversations![1]!.teamId = 'x'
    },
    () => {
      store.rows.agent_conversations![0]!.archivedAt = new Date()
    },
    () => {
      member = false
    },
  ]

  for (const edit of edits) {
    const child = store.rows.agent_conversations![1]!
    const parent = store.rows.agent_conversations![0]!

    child.parentSessionId = 'parent'
    child.teamId = 't'
    parent.userId = 'u'
    delete parent.archivedAt
    member = true
    const reportId = `case-${queued.length}`

    await update(reportId)
    edit()
    await deliverTaskReport(queued.at(-1)!)
  }
  expect(deliveries).toHaveLength(0)
})

test('a worker cannot report across ownership or team boundaries', async () => {
  store.rows.agent_conversations![0]!.userId = 'v'
  await expect(update()).rejects.toThrow('active Task')
  expect(queued).toHaveLength(0)
})

test('retrying an old report cannot overwrite a newer task state', async () => {
  await update('old')
  const old = store.rows.agent_task_reports![0]!

  old.createdAt = new Date(1)
  await update('new', 'Newer result')
  await update('old')
  expect(store.rows.agent_conversations![1]!.taskReport.summary).toBe('Newer result')
})

test('an explicit retry restarts the retained failed job and clears delivery failure', async () => {
  await update()
  const report = store.rows.agent_task_reports![0]!
  const job = jobs.get(`task-report-${report._id}`)!

  job.state = 'failed'
  job.attemptsMade = 5
  report.deliveryError = 'Delivery exhausted five attempts'
  expect((await update()).delivery).toBe('queued')
  expect(jobs.size).toBe(1)
  expect(job).toMatchObject({ state: 'waiting', attemptsMade: 0, retries: 1 })
  expect(report.deliveryError).toBeUndefined()
  await update()
  expect(job.retries).toBe(1)
  await deliverTaskReport(report._id)
  expect((await update()).delivery).toBe('delivered')
  expect(deliveries).toHaveLength(1)
})

test('a failed retry handoff keeps a visible error and can be retried again', async () => {
  await update()
  const report = store.rows.agent_task_reports![0]!

  report.deliveryError = 'Previous failure'
  queueFails = true
  await expect(update()).rejects.toThrow('queue offline')
  expect(report.deliveryError).toContain('could not be queued')
  queueFails = false
  expect((await update()).delivery).toBe('queued')
})
