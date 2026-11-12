export type SidebarPage = 0 | 1
export type SidebarPageChange = ((page: SidebarPage) => void) & { cancelPending?: () => void }

/** Choose the destination only after release; input must never snap mid-gesture. */
export function swipeDestination(
  page: SidebarPage,
  distance: number,
  width: number,
  velocity = 0,
  pageCount = 2,
): SidebarPage {
  const intentional =
    Math.abs(distance) >= Math.min(44, width * 0.18) ||
    (Math.abs(distance) >= 18 && Math.abs(velocity) >= 0.45)

  if (!intentional) return page
  if (distance < 0 && page < pageCount - 1) return (page + 1) as SidebarPage
  if (distance > 0 && page > 0) return (page - 1) as SidebarPage

  return page
}
