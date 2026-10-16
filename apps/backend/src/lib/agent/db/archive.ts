import { agentConversations } from './shared'

const restore = () => ({
  $unset: { archivedAt: '' as const },
  $set: { archiveRestoredAt: new Date() },
})

/**
 * Who may archive is the route's to check. Archiving also archives the owner's
 * threads nested below it, stamped with the same `archivedAt`; restoring brings
 * back exactly the descendants carrying that stamp, so a thread archived
 * earlier on its own stays archived.
 */
export async function setConversationArchived(sessionId: string, archived: boolean): Promise<void> {
  const conversation = await agentConversations().findOne(
    { sessionId },
    { projection: { sessionId: 1, userId: 1, teamId: 1, archivedAt: 1 } },
  )

  if (!conversation) return
  const { archivedAt } = conversation
  const descendants = await descendantSessionIds(conversation)

  if (archived) {
    await agentConversations().updateMany(
      { sessionId: { $in: [sessionId, ...descendants] }, archivedAt: { $exists: false } },
      { $set: { archivedAt: archivedAt ?? new Date() } },
    )

    return
  }
  await agentConversations().updateOne({ sessionId }, restore())
  if (archivedAt && descendants.length > 0) {
    await agentConversations().updateMany(
      { sessionId: { $in: descendants }, archivedAt },
      restore(),
    )
  }
}

// Only the same owner's conversations in the same team; `seen` stops a loop.
async function descendantSessionIds(root: {
  sessionId: string
  userId: string
  teamId?: string
}): Promise<string[]> {
  const seen = new Set([root.sessionId])
  let frontier = [root.sessionId]

  while (frontier.length > 0) {
    const children = await agentConversations()
      .find(
        {
          userId: root.userId,
          teamId: root.teamId ?? { $exists: false },
          parentSessionId: { $in: frontier },
        },
        { projection: { sessionId: 1 } },
      )
      .toArray()

    frontier = children.map((child) => child.sessionId).filter((id) => !seen.has(id))
    for (const id of frontier) seen.add(id)
  }
  seen.delete(root.sessionId)

  return [...seen]
}

/** Any new human turn brings an archived conversation back, whoever sends it. */
export async function restoreArchivedConversation(sessionId: string): Promise<boolean> {
  const result = await agentConversations().updateOne(
    { sessionId, archivedAt: { $exists: true } },
    { $unset: { archivedAt: '' }, $set: { archiveRestoredAt: new Date() } },
  )

  return result.modifiedCount > 0
}
