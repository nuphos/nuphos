import { agentConversations, withTeamScope } from './shared'

// Owner-only by construction: the query matches userId, so another member's
// (team-visible) conversation simply doesn't match. Returns false → 404.
export async function setConversationArchived(
  sessionId: string,
  userId: string,
  teamId: string | undefined,
  archived: boolean,
): Promise<boolean> {
  const result = await agentConversations().updateOne(
    withTeamScope({ sessionId, userId }, teamId),
    archived
      ? { $set: { archivedAt: new Date() } }
      : { $unset: { archivedAt: '' }, $set: { archiveRestoredAt: new Date() } },
  )

  return result.matchedCount > 0
}

/** Any new human turn brings an archived conversation back, whoever sends it. */
export async function restoreArchivedConversation(sessionId: string): Promise<boolean> {
  const result = await agentConversations().updateOne(
    { sessionId, archivedAt: { $exists: true } },
    { $unset: { archivedAt: '' }, $set: { archiveRestoredAt: new Date() } },
  )

  return result.modifiedCount > 0
}
