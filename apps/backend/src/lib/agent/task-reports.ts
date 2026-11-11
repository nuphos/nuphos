import { createHash } from 'node:crypto'

import { db } from '@/lib/db'
import { getTeamMembership } from '@/lib/identity'

import { getConversationBySessionId } from './db'
import { agentConversations } from './db/shared'
import { enqueueTaskReport } from './thread-queue'

export const TASK_STATUSES = ['working', 'waiting', 'ready', 'blocked', 'failed', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]
export type TaskReport = {
  _id: string
  userId: string
  teamId: string
  sessionId: string
  parentSessionId: string
  reportId: string
  status: TaskStatus
  summary: string
  createdAt: Date
  enqueuedAt?: Date
  deliveryError?: string
  deliveredAt?: Date
  droppedAt?: Date
}

export const taskReports = () => db().collection<TaskReport>('agent_task_reports')

export function taskReportDelivery(
  report: Pick<TaskReport, 'deliveredAt' | 'droppedAt' | 'deliveryError'>,
) {
  if (report.deliveredAt) return 'delivered'
  if (report.droppedAt) return 'dropped'
  if (report.deliveryError) return 'failed'

  return 'queued'
}

/** Stable per worker and report id, including across retries and backend restarts. */
export function taskReportKey(userId: string, teamId: string, sessionId: string, reportId: string) {
  return createHash('sha256')
    .update(JSON.stringify([userId, teamId, sessionId, reportId]))
    .digest('hex')
}

export async function reportTask(
  userId: string,
  teamId: string,
  sessionId: string,
  report: { reportId: string; status: TaskStatus; summary: string },
) {
  const child = await getConversationBySessionId(sessionId)
  const parent = child?.parentSessionId
    ? await getConversationBySessionId(child.parentSessionId)
    : null

  if (
    !child ||
    !parent ||
    child.userId !== userId ||
    parent.userId !== userId ||
    child.teamId !== teamId ||
    parent.teamId !== teamId ||
    child.kind === 'channel' ||
    parent.kind === 'channel' ||
    child.archivedAt ||
    parent.archivedAt ||
    !(await getTeamMembership(userId, teamId))
  )
    throw new Error('Report only from an active Task to its parent owned by you in this team.')

  const id = taskReportKey(userId, teamId, sessionId, report.reportId)
  const entry: TaskReport = {
    _id: id,
    userId,
    teamId,
    sessionId,
    parentSessionId: parent.sessionId,
    ...report,
    createdAt: new Date(),
  }

  await taskReports().updateOne({ _id: id }, { $setOnInsert: entry }, { upsert: true })
  const saved = await taskReports().findOne({ _id: id })

  if (
    !saved ||
    saved.parentSessionId !== parent.sessionId ||
    saved.status !== report.status ||
    saved.summary !== report.summary
  )
    throw new Error('A report id cannot be reused for a different report. Use a new id.')

  // An old report retried later must not replace the worker's newer state.
  await agentConversations().updateOne(
    {
      sessionId,
      userId,
      teamId,
      parentSessionId: parent.sessionId,
      $or: [
        { 'taskReport.at': { $exists: false } },
        { 'taskReport.at': { $lte: saved.createdAt } },
      ],
    },
    {
      $set: {
        taskReport: { id, status: saved.status, summary: saved.summary, at: saved.createdAt },
      },
    },
  )
  if (!saved.deliveredAt && !saved.droppedAt) {
    await enqueueTaskReport(id)
    await taskReports().updateOne({ _id: id }, { $set: { enqueuedAt: new Date() } })
  }

  return {
    report_id: report.reportId,
    status: report.status,
    delivery: taskReportDelivery(saved),
  }
}

/** The outbox repairs a crash between recording a report and adding its queue job. */
export async function recoverTaskReports() {
  const pending = await taskReports()
    .find({
      deliveredAt: { $exists: false },
      droppedAt: { $exists: false },
      enqueuedAt: { $exists: false },
    })
    .sort({ createdAt: 1 })
    .limit(100)
    .toArray()

  for (const report of pending) {
    await enqueueTaskReport(report._id)
    await taskReports().updateOne({ _id: report._id }, { $set: { enqueuedAt: new Date() } })
  }
}
