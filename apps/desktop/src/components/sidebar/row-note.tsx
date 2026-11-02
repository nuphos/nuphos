import { FinishedThreadsBadge } from './nest-guides'

import type { Item } from './types'
import type { ReactNode } from 'react'

/** What follows a row's label: its own note, then the badge for finished threads folded under it. */
export function rowNote(item: Item, done: Item[]): ReactNode {
  if (item.note == null && done.length === 0) return undefined

  return (
    <>
      {item.note}
      {done.length > 0 && <FinishedThreadsBadge threads={done} />}
    </>
  )
}
