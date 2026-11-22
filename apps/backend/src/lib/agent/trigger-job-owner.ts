import { ObjectId } from 'mongodb'

import { getConversationBySessionId } from './db'
import { taskReports } from './task-reports'
import { agentTriggers } from './trigger-db'

import type { Job } from 'bullmq'

/**
 * Whose a failed job is and when it was due, so its log line says which team and
 * conversation missed a run (#3718, #4475). A Trigger's fire also keeps the error.
 */
export async function whoseJob(
  job: Pick<Job, 'name' | 'data' | 'timestamp' | 'opts'> | undefined,
  error: Error,
): Promise<Record<string, string | undefined>> {
  if (!job) return {}
  // A cron fire carries its slot; any other job was due once its delay passed.
  const due = {
    scheduled_at: new Date(
      job.opts.prevMillis ?? job.timestamp + (job.opts.delay ?? 0),
    ).toISOString(),
  }
  const { triggerId, reportId, sessionId } = (job.data ?? {}) as Record<string, unknown>

  if (typeof triggerId === 'string' && ObjectId.isValid(triggerId)) {
    const trigger = await agentTriggers()
      .findOneAndUpdate(
        { _id: new ObjectId(triggerId) },
        { $set: { lastRunError: { message: error.message, at: new Date() } } },
        { projection: { teamId: 1, targetSessionId: 1 } },
      )
      .catch(() => null)

    return {
      ...due,
      trigger_id: triggerId,
      team_id: trigger?.teamId,
      session_id: trigger?.targetSessionId,
    }
  }
  if (typeof reportId === 'string') {
    const report = await taskReports()
      .findOne({ _id: reportId }, { projection: { teamId: 1, parentSessionId: 1 } })
      .catch(() => null)

    // The report is delivered to the parent conversation.
    return { ...due, team_id: report?.teamId, session_id: report?.parentSessionId }
  }
  if (typeof sessionId === 'string') {
    const conversation = await getConversationBySessionId(sessionId).catch(() => null)

    return { ...due, team_id: conversation?.teamId, session_id: sessionId }
  }

  return due
}
