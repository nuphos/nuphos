import clsx from 'clsx'

import type { Item } from './types'

/**
 * A sidebar row's detail line (linked work, merged PRs). Hidden at rest, it
 * rises under the lifted title while the row is hovered or focused, inside
 * the row's fixed height (see SessionRowSurface `revealDetail`).
 */
export function RowDetail({ item }: { item: Item }) {
  if (!item.description) return null

  return (
    <div
      // Empty when there is nothing to show (no linked work); the title then stays put.
      data-row-detail
      className={clsx(
        item.task && !item.icon && !item.iconNode && '[&>*]:pl-2 [&>*]:pr-9',
        'pointer-events-none absolute inset-x-0 top-[19px] translate-y-1.5 opacity-0',
        'transition-[opacity,transform] duration-[280ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]',
        'group-hover/session:pointer-events-auto group-hover/session:translate-y-0 group-hover/session:opacity-100',
        'group-focus-within/session:pointer-events-auto group-focus-within/session:translate-y-0',
        'group-focus-within/session:opacity-100 motion-reduce:transition-none [&>*]:pb-0',
      )}
    >
      {item.description}
    </div>
  )
}
