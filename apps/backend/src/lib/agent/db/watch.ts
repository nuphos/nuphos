import { descendantSessionIds } from './archive'
import { agentConversations } from './shared'

/**
 * Who receives a conversation's push notifications is the set of users
 * watching it. A conversation a person opened by hand starts watched by them;
 * one an agent, a trigger or a chat channel opened starts unwatched — the
 * channel already notifies the people in it.
 */
const UNWATCHED_SOURCES = ['agent', 'slack', 'discord', 'lark', 'mcp']
const UNWATCHED_SOURCE = new RegExp(`^(${UNWATCHED_SOURCES.join('|')})(\\.|$)`)

/** Whether an agent, a trigger or a chat channel opened it, rather than a person by hand. */
export function openedByAgent(opened: {
  source?: string
  parentSessionId?: string
  trigger?: unknown
}): boolean {
  return (
    Boolean(opened.parentSessionId) ||
    Boolean(opened.trigger) ||
    (opened.source !== undefined && UNWATCHED_SOURCE.test(opened.source))
  )
}

export function initialWatcherIds(
  userId: string,
  opened: { source?: string; parentSessionId?: string; trigger?: unknown },
): string[] {
  return openedByAgent(opened) ? [] : [userId]
}

/**
 * Unwatching also unwatches every thread nested below, whoever owns it. A
 * thread created later needs nothing inherited: it is agent-opened, so it
 * starts unwatched. Watching adds only the conversation itself.
 */
export async function setConversationWatched(
  sessionId: string,
  teamId: string | undefined,
  userId: string,
  watched: boolean,
): Promise<void> {
  if (watched) {
    await agentConversations().updateOne({ sessionId }, { $addToSet: { watcherIds: userId } })

    return
  }
  const descendants = await descendantSessionIds(sessionId, {
    teamId: teamId ?? { $exists: false },
  })

  await agentConversations().updateMany(
    { sessionId: { $in: [sessionId, ...descendants] } },
    { $pull: { watcherIds: userId } },
  )
}
