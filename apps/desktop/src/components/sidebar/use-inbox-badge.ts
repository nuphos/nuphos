import { useMentionNotifications } from '../../views/inbox/mentionNotification'
import { useShareApprovalNotifications } from '../../views/inbox/shareApprovalNotification'
import { useChannelMentions } from '../../views/inbox/useChannelMentions'
import { useInboxCount } from '../../views/inbox/useInbox'
import { useShareApprovals } from '../../views/inbox/useShareApprovals'

import type { Section } from './types'

/**
 * Badges the Inbox row with how many questions wait on the viewer,
 * how many teammates ask to use their computer, telling the owner about each new ask,
 * and the chats and agents that @mention them, announcing each new one.
 */
export function useInboxBadge(teamId: string, sections: Section[]): Section[] {
  // The one always-mounted reader, so the one that polls them.
  const { approvals } = useShareApprovals(teamId, { poll: true })
  const mentions = useChannelMentions(teamId, { poll: true })
  const count = useInboxCount(teamId) + approvals.length + (mentions?.length ?? 0)

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
