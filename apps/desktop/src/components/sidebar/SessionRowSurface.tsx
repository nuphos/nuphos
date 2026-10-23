import clsx from 'clsx'

import { SESSION_DRAG_TYPE } from '../../app/workspace/splitLayout'

import type { Item } from './types'
import type { HTMLAttributes, MouseEvent } from 'react'

type Props = Pick<HTMLAttributes<HTMLDivElement>, 'children' | 'onContextMenu'> & {
  item: Item
  active: boolean
  onSelect: (key: string) => void
  onOpenKey?: (key: string, label: string | null, newTab: boolean) => void
  /** A chat row drags onto the conversation area to open it in a split. */
  sessionId?: string | null
  teamId?: string
}

export function SessionRowSurface({
  item,
  active,
  onSelect,
  onOpenKey,
  sessionId,
  teamId,
  ...props
}: Props) {
  const activate = (event: MouseEvent) => {
    if (!item.description || !item.enabled || event.button !== 0) return
    if ((event.target as HTMLElement).closest('button')) return
    const newTab = event.metaKey || event.ctrlKey

    if (item.onActivate) item.onActivate(newTab)
    else if (newTab && onOpenKey) onOpenKey(item.key, null, true)
    else onSelect(item.key)
  }

  return (
    <div
      {...props}
      draggable={Boolean(sessionId)}
      onDragStart={(event) => {
        if (!sessionId) return
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData(SESSION_DRAG_TYPE, JSON.stringify({ sessionId, teamId }))
      }}
      className={clsx(
        item.description &&
          'group rounded-lg transition-colors focus-within:bg-[var(--sidebar-overlay-focus)]',
        item.description &&
          (active
            ? 'bg-[var(--sidebar-overlay-active)]'
            : 'hover:bg-[var(--sidebar-overlay-hover)]'),
      )}
      onKeyDown={
        props.onContextMenu
          ? (event) => {
              // ⇧F10 opens the row's menu from the keyboard, anchored under the row.
              if (!event.shiftKey || event.key !== 'F10') return
              event.preventDefault()
              const row = event.currentTarget.getBoundingClientRect()
              const init = { bubbles: true, clientX: row.left + 24, clientY: row.bottom }

              event.currentTarget.dispatchEvent(new window.MouseEvent('contextmenu', init))
            }
          : undefined
      }
      // A press may start a drag, so a draggable row navigates on release.
      onPointerDown={sessionId ? undefined : activate}
      onClick={sessionId ? activate : undefined}
    />
  )
}
