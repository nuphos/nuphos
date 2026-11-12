export type SidebarTaskState = 'attention' | 'working' | 'idle'

/** A question needs attention even while an agent continues other work. */
export function sidebarTaskState({
  waiting,
  working,
  unread,
}: {
  waiting: boolean
  working: boolean
  unread: boolean
}): SidebarTaskState {
  if (waiting) return 'attention'
  if (working) return 'working'

  return unread ? 'attention' : 'idle'
}
