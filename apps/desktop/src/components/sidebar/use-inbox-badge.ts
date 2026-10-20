import { useInboxCount } from '../../views/inbox/useInbox'

import type { Section } from './types'

/** Badges the Inbox row with how many of the viewer's conversations wait on them. */
export function useInboxBadge(teamId: string, sections: Section[]): Section[] {
  const count = useInboxCount(teamId) ?? 0

  if (count === 0) return sections

  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.key === 'team.inbox' ? { ...item, badge: count } : item,
    ),
  }))
}
