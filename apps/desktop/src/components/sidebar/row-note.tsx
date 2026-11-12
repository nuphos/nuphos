import { FinishedThreadsBadge } from './nest-guides'

import type { sectionFolds } from './chat-sections'
import type { Item } from './types'
import type { ReactNode } from 'react'

/** What follows a row's label: its own note, then the toggle of its done group. */
export function rowNote(
  item: Item,
  done: Item[],
  folds: Pick<ReturnType<typeof sectionFolds>, 'doneOpen' | 'toggleDone'>,
): ReactNode {
  if (item.note == null && done.length === 0) return undefined

  return (
    <>
      {item.note}
      {done.length > 0 && (
        <FinishedThreadsBadge
          count={done.length}
          open={folds.doneOpen(item.key)}
          onToggle={() => folds.toggleDone(item.key)}
        />
      )}
    </>
  )
}
