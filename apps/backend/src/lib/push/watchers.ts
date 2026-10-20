import { conversationAccess } from '@/lib/agent/db/access'
import { getTeamMembership } from '@/lib/identity'

import type { AgentConversation } from '@/lib/agent/db'

/**
 * Watching is a preference, not a grant: a watcher who has since lost read
 * access — removed from the conversation, general access narrowed, or out of
 * the team — gets nothing, without any access change having to clean up
 * `watcherIds`.
 */
export async function watcherCanRead(
  conversation: Pick<
    AgentConversation,
    'userId' | 'teamId' | 'generalAccess' | 'participantIds' | 'viewOnlyIds' | 'managerIds'
  >,
  userId: string,
  isMember: (userId: string, teamId: string) => Promise<unknown> = getTeamMembership,
): Promise<boolean> {
  if (conversation.userId === userId) return true
  if (!conversation.teamId || !conversationAccess(conversation, userId)) return false

  return Boolean(await isMember(userId, conversation.teamId))
}
