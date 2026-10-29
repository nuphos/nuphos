import { Children } from 'react'

import type { ReactNode } from 'react'

/** Which sides of the row have more machines to scroll to. A pixel of slack: fractional zoom can
 * leave the row a hair short of its end. */
export function shelfEdges(row: { scrollLeft: number; clientWidth: number; scrollWidth: number }) {
  return {
    left: row.scrollLeft > 1,
    right: row.scrollLeft + row.clientWidth < row.scrollWidth - 1,
  }
}

/** What the row's observers follow: how many machines it holds. Every metrics poll re-renders it
 * with new elements for the same machines, and that must not tear the observers down. */
export const shelfWatchKey = (children: ReactNode) => Children.count(children)
