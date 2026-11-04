import { useMentionNotifications } from '../../views/inbox/mentionNotification'
import { useShareApprovalNotifications } from '../../views/inbox/shareApprovalNotification'
import { useChannelMentions } from '../../views/inbox/useChannelMentions'
import { useInboxCount } from '../../views/inbox/useInbox'
import { useShareApprovals } from '../../views/inbox/useShareApprovals'

import type { Section } from './types'

/**
 * Badges the Inbox row with how many of the viewer's conversations wait on them,
 * how many teammates ask to use their computer, telling the owner about each new ask,
 * and the chats and agents that @mention them, announcing each new one.
 */
export function useInboxBadge(teamId: string, sections: Section[]): Section[] {
  const { approvals } = useShareApprovals(teamId)
  const mentions = useChannelMentions(teamId)
  const count = (useInboxCount(teamId) ?? 0) + approvals.length + (mentions?.length ?? 0)

  useShareApprovalNotifications(teamId, approvals)
  useMentionNotifications(teamId, mentions)

  if (count === 0) return sections

  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.key === 'team.inbox' ? { ...item, badge: count } : item,
    ),
  }))
}
