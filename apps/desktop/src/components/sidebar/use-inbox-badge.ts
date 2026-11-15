import { useMentionNotifications } from '../../views/inbox/mentionNotification'
import { useShareApprovalNotifications } from '../../views/inbox/shareApprovalNotification'
import { useChannelMentions } from '../../views/inbox/useChannelMentions'
import { useInboxCount } from '../../views/inbox/useInbox'
import { useShareApprovals } from '../../views/inbox/useShareApprovals'

/**
 * The Inbox tab's badge: how many questions wait on the viewer,
 * how many teammates ask to use their computer, telling the owner about each new ask,
 * and the chats and agents that @mention them, announcing each new one and each invite.
 */
export function useInboxBadge(teamId: string): number {
  const { approvals } = useShareApprovals(teamId)
  const mentions = useChannelMentions(teamId)

  useShareApprovalNotifications(teamId, approvals)
  useMentionNotifications(teamId, mentions)

  const listed = mentions?.filter((mention) => !mention.invited).length ?? 0

  return useInboxCount(teamId) + approvals.length + listed
}
