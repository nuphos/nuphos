/** The sidebar's pages, in order: Bots, Tasks and the Inbox. */
export const SIDEBAR_PAGES = ['bots', 'tasks', 'inbox'] as const
export type SidebarPage = 0 | 1 | 2
export type SidebarPageChange = ((page: SidebarPage) => void) & { cancelPending?: () => void }

/** Choose the destination only after release; input must never snap mid-gesture. */
export function swipeDestination(
  page: SidebarPage,
  distance: number,
  width: number,
  velocity = 0,
  pageCount: number = SIDEBAR_PAGES.length,
): SidebarPage {
  const intentional =
    Math.abs(distance) >= Math.min(44, width * 0.18) ||
    (Math.abs(distance) >= 18 && Math.abs(velocity) >= 0.45)

  if (!intentional) return page
  if (distance < 0 && page < pageCount - 1) return (page + 1) as SidebarPage
  if (distance > 0 && page > 0) return (page - 1) as SidebarPage

  return page
}
