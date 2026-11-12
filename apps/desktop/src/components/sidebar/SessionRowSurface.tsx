import clsx from 'clsx'

import { SESSION_DRAG_TYPE } from '../../app/workspace/splitLayout'

import { MAKE_BOT_DRAG_TYPE } from './bot-drop'
import { BOT_PIN_DRAG_TYPE } from './bot-pin-drag'
import { canBecomeBot } from './make-bot'
import { setRowDragImage } from './rowDragImage'

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
  /** The row shows its description below the title on hover (a fixed-height row). */
  revealDetail?: boolean
}

export function SessionRowSurface({
  item,
  active,
  onSelect,
  onOpenKey,
  sessionId,
  teamId,
  revealDetail = false,
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
        // Moving opens it in a split; copying onto Bots makes it a Bot and keeps the Task.
        event.dataTransfer.effectAllowed = 'copyMove'
        if (item.bot || item.channel) event.dataTransfer.setData(BOT_PIN_DRAG_TYPE, item.key)
        setRowDragImage(event, event.currentTarget, item.label)
        event.dataTransfer.setData(SESSION_DRAG_TYPE, JSON.stringify({ sessionId, teamId }))
        // A Task can also be dropped on Bots to become one, as its menu's "Make this a Bot";
        // a sub-task cannot, so dragging it about never turns it into a Bot by accident.
        if (canBecomeBot(item)) event.dataTransfer.setData(MAKE_BOT_DRAG_TYPE, sessionId)
      }}
      data-bot-pin-key={item.bot || item.channel ? item.key : undefined}
      data-sidebar-row
      className={clsx(
        // A row with a detail line keeps one height; the detail rises into it on hover.
        revealDetail && 'group/session relative h-9 overflow-hidden',
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
