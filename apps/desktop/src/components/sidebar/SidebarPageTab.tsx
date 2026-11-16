import clsx from 'clsx'
import { Reorder, useDragControls, useReducedMotion } from 'framer-motion'
import { Inbox, MessagesSquare } from 'lucide-react'

import { api } from '../../api'
import { comboText } from '../../lib/platform'
import { CountBadge } from '../ui/count-badge'
import { Tooltip } from '../ui/tooltip'

import { BotsModeIcon } from './BotsModeIcon'
import { SIDEBAR_PAGES } from './swipe-gesture'
import { useTabPickup } from './useTabPickup'

import type { SidebarPage } from './swipe-gesture'
import type { KeyboardEvent, RefObject } from 'react'

const REST = { scale: 1, y: 0, rotate: 0, boxShadow: '0 0 0 0 rgba(0,0,0,0)' }
/** Picked up: a slight tilt and a lift, like Arc's sidebar. */
const LIFTED = {
  scale: 1.14,
  y: 0,
  rotate: -4,
  boxShadow: '0 10px 22px -6px rgba(0,0,0,0.4)',
}
/** Pointer travel (px) before a press becomes a drag. */
const THRESHOLD = 3
/** Neighbours make room on a spring; the dropped tab settles with a soft bounce. */
const MOVE = {
  type: 'spring',
  stiffness: 520,
  damping: 30,
  mass: 0.8,
} as const
const SETTLE = { bounceStiffness: 420, bounceDamping: 20 }
const REDUCED_SETTLE = { bounceStiffness: 2000, bounceDamping: 120 }

/** One draggable mode tab. The bar owns order and selection; this owns the gesture. */
export function SidebarPageTab({
  page,
  label,
  shortcut,
  count,
  active,
  bounds,
  hintId,
  onSelect,
  onKeyDown,
  onDrop,
}: {
  page: SidebarPage
  /** Accessible name, already carrying the count when there is one. */
  label: string
  shortcut: string
  count: number
  active: boolean
  bounds: RefObject<HTMLDivElement | null>
  hintId: string
  onSelect: () => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
  onDrop: () => void
}) {
  const id = SIDEBAR_PAGES[page]
  const controls = useDragControls()
  const reduce = useReducedMotion() ?? false
  const pickup = useTabPickup(THRESHOLD, (press) => {
    api.sidebarAlignmentFeedback?.()
    controls.start(press)
  })
  const lifted = pickup.lifted

  return (
    <Reorder.Item
      as="div"
      value={page}
      role="presentation"
      dragListener={false}
      dragControls={controls}
      dragConstraints={bounds}
      dragElastic={0.12}
      dragTransition={reduce ? REDUCED_SETTLE : SETTLE}
      transition={reduce ? { duration: 0 } : MOVE}
      animate={lifted && !reduce ? LIFTED : REST}
      onDragEnd={() => {
        pickup.drop()
        onDrop()
      }}
      onPointerDown={pickup.onPointerDown}
      className={clsx('sidebar-page-tab', lifted && 'is-lifted')}
    >
      <Tooltip
        content={`${label}  ${comboText(shortcut)}`}
        disabled={lifted}
        trigger={
          <button
            id={`sidebar-${id}-tab`}
            aria-keyshortcuts={shortcut.replace('ctrl', 'Control').replace('alt', 'Alt')}
            aria-controls={`sidebar-${id}-page`}
            role="tab"
            aria-label={label}
            aria-describedby={hintId}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => {
              if (!pickup.consumeClick()) onSelect()
            }}
            onKeyDown={onKeyDown}
            className={clsx('sidebar-page-indicator', active && 'is-active')}
          />
        }
      >
        {id === 'bots' && <BotsModeIcon />}
        {id === 'tasks' && <MessagesSquare aria-hidden strokeWidth={1.8} className="size-4" />}
        {id === 'inbox' && <Inbox aria-hidden strokeWidth={1.8} className="size-4" />}
        {count > 0 && <CountBadge count={count} size="sm" className="absolute -right-1 -top-1" />}
      </Tooltip>
    </Reorder.Item>
  )
}
