import { agentConversations } from './shared'

/** Who may archive is the route's to check. */
export async function setConversationArchived(sessionId: string, archived: boolean): Promise<void> {
  await agentConversations().updateOne(
    { sessionId },
    archived
      ? { $set: { archivedAt: new Date() } }
      : { $unset: { archivedAt: '' }, $set: { archiveRestoredAt: new Date() } },
  )
}

/** Any new human turn brings an archived conversation back, whoever sends it. */
export async function restoreArchivedConversation(sessionId: string): Promise<boolean> {
  const result = await agentConversations().updateOne(
    { sessionId, archivedAt: { $exists: true } },
    { $unset: { archivedAt: '' }, $set: { archiveRestoredAt: new Date() } },
  )

  return result.modifiedCount > 0
}
