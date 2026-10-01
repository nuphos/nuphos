import { agentConversations } from '@/lib/agent/db/shared'

export type OwnedSessionIds = (teamId: string, sessionIds: string[]) => Promise<Set<string>>

export const teamOwnedSessionIds: OwnedSessionIds = async (teamId, sessionIds) => {
  const docs = await agentConversations()
    .find({ teamId, 'claudeCodePreview.openabSessionId': { $in: sessionIds } })
    .project<{ claudeCodePreview?: { openabSessionId?: string } }>({
      'claudeCodePreview.openabSessionId': 1,
    })
    .toArray()

  return new Set(docs.flatMap((doc) => doc.claudeCodePreview?.openabSessionId ?? []))
}

/**
 * The part of a runtime's session inventory that belongs to `teamId`. A runtime
 * can be bound to several teams, so its inventory is attributed by the team's own
 * OpenAB session ids. `null` when the runtime is too old to name its sessions:
 * such an inventory cannot be attributed and must not be reported as the team's.
 */
export async function teamRuntimeSessions<T>(
  teamId: string,
  sessions: T[],
  owned: OwnedSessionIds = teamOwnedSessionIds,
): Promise<T[] | null> {
  const ids: string[] = []

  for (const session of sessions) {
    const sessionId =
      session instanceof Object ? (session as { sessionId?: unknown }).sessionId : undefined

    if (typeof sessionId !== 'string' || !sessionId) return null
    ids.push(sessionId)
  }
  if (ids.length === 0) return []
  const mine = await owned(teamId, [...new Set(ids)])

  return sessions.filter((_, index) => mine.has(ids[index] ?? ''))
}
