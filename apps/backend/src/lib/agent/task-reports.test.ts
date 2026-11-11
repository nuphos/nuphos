import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useConversationTurn } from '@/lib/test/doubles/conversation-turn'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useThreadQueue } from '@/lib/test/doubles/thread-queue'
import { FakeCoordinationStore } from '@/lib/test/fake-coordination-store'

import { deliverTaskReport } from './task-report-delivery'
import { recoverTaskReports, reportTask } from './task-reports'

const store = new FakeCoordinationStore()
let member = true
let queueFails = false
const queued: string[] = []
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
