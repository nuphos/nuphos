import { useChannelMentions } from '../../views/inbox/useChannelMentions'
import { useInboxCount } from '../../views/inbox/useInbox'
import { useShareApprovals } from '../../views/inbox/useShareApprovals'

import type { Section } from './types'

/**
 * Badges the Inbox row with how many of the viewer's conversations wait on them,
 * how many teammates ask to use their computer, and channels that @mention them.
 */
export function useInboxBadge(teamId: string, sections: Section[]): Section[] {
  const count =
    (useInboxCount(teamId) ?? 0) +
    useShareApprovals(teamId).approvals.length +
    useChannelMentions(teamId).length

  if (count === 0) return sections

  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.key === 'team.inbox' ? { ...item, badge: count } : item,
    ),
  }))
}
