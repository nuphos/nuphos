import { Fragment } from 'react'

import type { Item } from './types'

/**
 * One status dot for whatever a folded thread hides; the rest render null.
 * Renders nothing at all when nothing is folded, so an idle row's trailing slot
 * stays empty and takes no space.
 */
export function FoldedStatus({ rows }: { rows: Item[] }) {
  if (rows.length === 0) return null

  return (
    <span className="contents [&>*:not(:first-child)]:hidden">
      {rows.map((row) => (
        <Fragment key={row.key}>{row.foldedStatus}</Fragment>
      ))}
    </span>
  )
}
