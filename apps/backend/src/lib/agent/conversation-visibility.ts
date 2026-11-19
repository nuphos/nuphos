import type { NuphosTeamRole } from '@/lib/identity/types'

/**
 * Whether `viewer` may see this conversation's name (its title, or the Bot's or Task's name)
 * in a team-wide view such as usage or activity. Everyone sees their own; an administrator
 * also sees the team's, except a conversation its owner made private; anyone else sees only
 * that a teammate's conversation exists.
 */
export function canSeeConversationName(
  conversation: { userId: string; generalAccess?: string },
  viewer: { userId: string; teamRole: NuphosTeamRole },
): boolean {
  if (conversation.userId === viewer.userId) return true

  return viewer.teamRole === 'ADMINISTRATOR' && conversation.generalAccess !== 'none'
}
