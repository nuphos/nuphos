import clsx from 'clsx'

import type { Item } from './types'
import type { HTMLAttributes } from 'react'

type Props = Pick<HTMLAttributes<HTMLDivElement>, 'children' | 'onContextMenu'> & {
  item: Item
  active: boolean
  onSelect: (key: string) => void
  onOpenKey?: (key: string, label: string | null, newTab: boolean) => void
}

export function SessionRowSurface({ item, active, onSelect, onOpenKey, ...props }: Props) {
  return (
    <div
      {...props}
      className={clsx(
        item.description &&
          'group rounded-lg transition-colors focus-within:bg-[var(--sidebar-overlay-focus)]',
        item.description &&
          (active
            ? 'bg-[var(--sidebar-overlay-active)]'
            : 'hover:bg-[var(--sidebar-overlay-hover)]'),
      )}
      onPointerDown={(event) => {
        if (!item.description || !item.enabled || event.button !== 0) return
        if ((event.target as HTMLElement).closest('button')) return
        const newTab = event.metaKey || event.ctrlKey

        if (item.onActivate) item.onActivate(newTab)
        else if (newTab && onOpenKey) onOpenKey(item.key, null, true)
        else onSelect(item.key)
      }}
    />
  )
}
