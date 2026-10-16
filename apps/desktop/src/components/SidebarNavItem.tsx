import { Button as BaseButton } from '@base-ui/react/button'
import clsx from 'clsx'

import { useHoverMarquee } from '../hooks/useHoverMarquee'

import type { LucideIcon } from 'lucide-react'
import type React from 'react'
import type { ReactNode } from 'react'

export const SIDEBAR_PANEL_PADDING_CLASS = 'px-2.5 pb-5'
export const SIDEBAR_ROW_CLASS = 'h-[30px] px-2 gap-2.5 rounded-lg text-[14px] font-[450]'
export const SIDEBAR_GROUP_GAP_CLASS = 'mb-5'
export const SIDEBAR_GROUP_ITEMS_CLASS = 'space-y-0.5'
export const SIDEBAR_GROUP_TITLE_CLASS = 'px-2 pt-1.5 pb-1 text-[13px] text-tertiary font-medium'

export function SidebarNavIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.8} />
}

type SidebarNavItemProps = {
  /**
   * Icon element sized by the caller (e.g. `w-3.5 h-3.5`). Its color follows the
   * active/hover state via `currentColor` — pass no color class to inherit it,
   * or set an explicit color class to opt out (e.g. always-tertiary badges).
   */
  icon: ReactNode
  label: string
  active: boolean
  sharedBackground?: boolean
  /** Receives the event so callers can honour cmd/ctrl-click (open in a new tab). */
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  /** Optional count rendered as a small badge to the right of the label. */
  badge?: number
  /** Optional trailing control (e.g. a hover-revealed action). Rendered after
   *  the badge; the caller owns its visibility and click handling (remember to
   *  stopPropagation so the row's onClick doesn't also fire). */
  trailing?: ReactNode
  /** A control pinned to the row's right edge that hover actions never cover
   *  (a fold chevron). */
  edge?: ReactNode
  /** Controls revealed on hover. They sit over the right end of the row's content,
   *  which fades out beneath them, so nothing in the row moves when they appear.
   *  `hoverActionsWidth` is their width in px. */
  hoverActions?: ReactNode
  hoverActionsWidth?: number
}

/**
 * The single source of truth for a sidebar-style navigation row — used by both
 * the main app sidebar and the settings page so their active/hover/disabled
 * treatments never drift apart.
 */
export function SidebarNavItem({
  icon,
  label,
  active,
  sharedBackground = false,
  onClick,
  disabled = false,
  badge,
  trailing,
  edge,
  hoverActions,
  hoverActionsWidth = 0,
}: SidebarNavItemProps) {
  const { containerRef, start, stop } = useHoverMarquee<HTMLSpanElement>(label)

  return (
    <BaseButton
      disabled={disabled}
      onPointerEnter={start}
      onPointerLeave={stop}
      // Keyboard focus reveals the label too; a click's focus does not.
      onFocus={(event) => {
        if (event.currentTarget.matches(':focus-visible')) start()
      }}
      onBlur={stop}
      onPointerDown={(event: React.PointerEvent<HTMLButtonElement>) => {
        // Navigate on press, not on release — same reasoning as the tab strip:
        // waiting for `click` adds the held mouse button to perceived latency.
        // Keyboard activation still arrives as a click with detail 0 below.
        if (disabled || event.button !== 0) return
        onClick(event)
      }}
      onClick={(event) => {
        if (event.detail !== 0) return
        onClick(event)
      }}
      className={clsx(
        SIDEBAR_ROW_CLASS,
        'group relative w-full flex items-center transition-colors outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0',
        !sharedBackground && 'focus-visible:bg-[var(--sidebar-overlay-focus)]',
        active
          ? sharedBackground
            ? 'text-main'
            : 'bg-[var(--sidebar-overlay-active)] text-main'
          : disabled
            ? 'text-tertiary opacity-40 cursor-not-allowed'
            : sharedBackground
              ? 'text-secondary'
              : 'text-secondary hover:bg-[var(--sidebar-overlay-hover)]',
      )}
    >
      <span
        className={clsx(
          'flex-1 min-w-0 flex items-center gap-2.5',
          hoverActions != null && 'sidebar-row-content',
        )}
        style={{ '--row-actions-w': `${hoverActionsWidth}px` } as React.CSSProperties}
      >
        <span
          className={clsx(
            'flex-shrink-0 flex items-center transition-colors [&_svg]:size-4',
            active ? 'text-main' : 'text-tertiary group-hover:text-main',
          )}
        >
          {icon}
        </span>
        <span ref={containerRef} className="t-marquee flex-1 text-left">
          {label}
        </span>
        {badge !== undefined && badge > 0 && (
          <span className="flex-shrink-0 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-zViolet-500 text-white text-[11px] font-medium leading-none">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
        {/* Presses on a trailing control must not navigate the row. Its click
            already stopPropagation()s, but activation now happens at
            pointerdown — so the press has to be fenced off here too. */}
        <Fenced>{trailing}</Fenced>
      </span>
      <Fenced>{edge}</Fenced>
      <Fenced
        className={clsx(
          'absolute inset-y-0 flex items-center gap-1 opacity-0 pointer-events-none transition-opacity duration-100 group-hover:opacity-100 group-hover:pointer-events-auto',
          edge != null ? 'right-[38px]' : 'right-2',
        )}
      >
        {hoverActions}
      </Fenced>
    </BaseButton>
  )
}

/** Keeps presses inside from reaching the row's pointerdown navigation. */
function Fenced({ className = 'contents', children }: { className?: string; children: ReactNode }) {
  if (children == null) return null

  return (
    <span className={className} onPointerDown={(event) => event.stopPropagation()}>
      {children}
    </span>
  )
}
