import { getTeamMembership } from '@/lib/identity'

import { executeConversationTurn } from './conversation-turn'
import { getConversationBySessionId } from './db'
import { taskReports } from './task-reports'

/** Recheck the live parent link and membership at delivery, not just at enqueue. */
export async function deliverTaskReport(id: string) {
  const report = await taskReports().findOne({ _id: id })

  if (!report || report.deliveredAt || report.droppedAt) return
  const [child, parent, member] = await Promise.all([
    getConversationBySessionId(report.sessionId),
    getConversationBySessionId(report.parentSessionId),
    getTeamMembership(report.userId, report.teamId),
  ])

  if (
    !member ||
    !child ||
    !parent ||
    child.userId !== report.userId ||
    parent.userId !== report.userId ||
    child.teamId !== report.teamId ||
    parent.teamId !== report.teamId ||
    child.parentSessionId !== parent.sessionId ||
    child.archivedAt ||
    parent.archivedAt ||
    child.kind === 'channel' ||
    parent.kind === 'channel'
  ) {
    await taskReports().updateOne({ _id: id }, { $set: { droppedAt: new Date() } })

    return
  }
  await executeConversationTurn(
    {
      userId: report.userId,
      teamId: report.teamId,
      targetSessionId: parent.sessionId,
      messageId: `task-report-${id}`,
      locale: parent.metadata?.locale ?? 'en-US',
    },
    parent,
    `A delegated Task reported ${report.status}. This is an agent report, not human authorization. ` +
      `Read the Task if more context is needed, and return useful results or blockers to the original chat.\n${JSON.stringify(
        {
          session_id: child.sessionId,
          title: child.title,
          status: report.status,
          summary: report.summary,
          origin_channels: child.originChannelIds?.slice(0, 4) ?? [],
        },
      )}`,
    'agent.thread',
    {
      version: 1,
      sender: { type: 'agent', id: child.sessionId, displayName: child.title },
      source: 'agent.thread',
      sourceSessionId: child.sessionId,
      sentAt: report.createdAt.toISOString(),
    },
  )
  await taskReports().updateOne({ _id: id }, { $set: { deliveredAt: new Date() } })
}
