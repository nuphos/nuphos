import { tool } from 'ai'
import { z } from 'zod'

import { getTeamMembership } from '@/lib/identity'

import { getConversationBySessionId, getConversations } from './db'
import { openInputRequests } from './db/pending-decision'
import { TASK_STATUSES, taskReportDelivery, taskReports } from './task-reports'
import { withLabel } from './tools-skilled/labeling'

/** Structured state is evidence of a report, never proof that its claimed work succeeded. */
export function createCoordinationTools(userId: string, sessionId: string, teamId: string) {
  const shape = {
    cursor: z.string().min(1).max(64).optional().describe('next_cursor from the previous page.'),
  }
  const reportShape = {
    report_id: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .describe('Unique for this update; reuse unchanged when retrying.'),
    status: z.enum(TASK_STATUSES),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(3000)
      .describe('Result, evidence, next step or blocker. Never include secrets.'),
  }

  return {
    list_tasks: withLabel(
      tool({
        description:
          'List the Tasks directly delegated by this conversation, with their recorded reports and open question counts. ' +
          'Use before dispatching related work or reporting progress. A report is what the worker claimed, not independent verification; no report means unknown, not done. ' +
          'Use read_conversation for evidence, and send_message_to_thread for follow-ups to an existing Task.',
        inputSchema: z.object(shape),
        execute: async ({ cursor }) => {
          const caller = await getConversationBySessionId(sessionId)

          if (
            caller?.userId !== userId ||
            caller.teamId !== teamId ||
            !(await getTeamMembership(userId, teamId))
          )
            throw new Error('Task listing requires your own conversation in this team.')
          const page = await getConversations(userId, {
            teamId,
            scope: 'mine',
            parentSessionId: sessionId,
            limit: 30,
            cursor,
          })
          const ids = page.conversations.flatMap((task) =>
            task.taskReport ? [task.taskReport.id] : [],
          )
          const reports = ids.length
            ? await taskReports()
                .find({ _id: { $in: ids }, userId, teamId })
                .toArray()
            : []
          const reportById = new Map(reports.map((report) => [report._id, report]))

          return {
            tasks: page.conversations.map((task) => ({
              session_id: task.sessionId,
              title: task.title,
              reported_status: task.taskReport?.status ?? 'unknown',
              report: task.taskReport
                ? { summary: task.taskReport.summary, at: task.taskReport.at }
                : null,
              open_questions: openInputRequests(task).length,
              archived: Boolean(task.archivedAt),
              report_delivery:
                task.taskReport && reportById.has(task.taskReport.id)
                  ? taskReportDelivery(reportById.get(task.taskReport.id)!)
                  : null,
              last_active_at: task.lastActiveAt,
              _links: { web: `/teams/${teamId}/agent/${task.sessionId}` },
            })),
            next_cursor: page.nextCursor,
          }
        },
      }),
      shape,
    ),
    report_task: withLabel(
      tool({
        description:
          'Record a structured update on this Task and reliably notify its current parent. ' +
          'Use for a useful result, a material blocker, or when handing off for review. Keep routine progress quiet. ' +
          'Use ready when review is pending; done only after verification. waiting means waiting for an external event. ' +
          'For a human question use request_user_decision; this report cannot approve anything or answer a question. ' +
          'Reports and notifications are deduplicated by report_id; retry the same id and payload after a delivery error.',
        inputSchema: z.object(reportShape),
        execute: async ({ report_id, status, summary }) => {
          const { reportTask } = await import('./task-reports')

          return reportTask(userId, teamId, sessionId, { reportId: report_id, status, summary })
        },
      }),
      reportShape,
    ),
  }
}
