import { useMentionNotifications } from '../../views/inbox/mentionNotification'
import { useChannelMentions } from '../../views/inbox/useChannelMentions'
import { useInboxCount } from '../../views/inbox/useInbox'

/**
 * The Inbox tab's badge: how many questions wait on the viewer, and the chats
 * and agents that @mention them, announcing each new one and each invite.
 */
export function useInboxBadge(teamId: string): number {
  const mentions = useChannelMentions(teamId)

  useMentionNotifications(teamId, mentions)

  const listed = mentions?.filter((mention) => !mention.invited).length ?? 0

  return useInboxCount(teamId) + listed
}
