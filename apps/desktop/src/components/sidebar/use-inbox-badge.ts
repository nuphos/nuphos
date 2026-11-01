import { useShareApprovalNotifications } from '../../views/inbox/shareApprovalNotification'
import { useInboxCount } from '../../views/inbox/useInbox'
import { useShareApprovals } from '../../views/inbox/useShareApprovals'

import type { Section } from './types'

/**
 * Badges the Inbox row with how many of the viewer's conversations wait on them,
 * and how many teammates ask to use their computer, telling the owner about each new ask.
 */
export function useInboxBadge(teamId: string, sections: Section[]): Section[] {
  const { approvals } = useShareApprovals(teamId)
  const count = (useInboxCount(teamId) ?? 0) + approvals.length

  useShareApprovalNotifications(teamId, approvals)

  if (count === 0) return sections

  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.key === 'team.inbox' ? { ...item, badge: count } : item,
    ),
  }))
}
