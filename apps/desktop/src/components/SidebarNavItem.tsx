import { Button as BaseButton } from '@base-ui/react/button'
import clsx from 'clsx'
import { useId } from 'react'

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
  /** A control pinned to the row's right edge, after the trailing slot (a fold
   *  chevron). */
  edge?: ReactNode
  /** Controls that take the trailing slot's place while the row is hovered or
   *  focused: at rest the slot shows `trailing`, on hover these instead. */
  hoverActions?: ReactNode
  /** Larger Agent row; other navigation keeps its compact height. */
  comfortable?: boolean
  /** Wait for the click when a press may start a drag instead. */
  navigateOnRelease?: boolean
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
  navigateOnRelease = false,
  comfortable = false,
}: SidebarNavItemProps) {
  const { containerRef, start, stop } = useHoverMarquee<HTMLSpanElement>(label)
  const id = useId()
  const badgeShown = badge !== undefined && badge > 0

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
      aria-current={active ? 'page' : undefined}
      // The row is named by its own text and state. Its hover actions sit inside
      // it but are controls of their own, not part of what the row is called.
      aria-labelledby={
        hoverActions == null
          ? undefined
          : [`${id}-label`, badgeShown && `${id}-badge`, `${id}-trailing`].filter(Boolean).join(' ')
      }
      onPointerDown={(event: React.PointerEvent<HTMLButtonElement>) => {
        // Navigate on press, not on release — same reasoning as the tab strip:
        // waiting for `click` adds the held mouse button to perceived latency.
        // Keyboard activation still arrives as a click with detail 0 below.
        if (disabled || navigateOnRelease || event.button !== 0) return
        onClick(event)
      }}
      onClick={(event) => {
        if (event.detail !== 0 && !navigateOnRelease) return
        onClick(event)
      }}
      className={clsx(
        SIDEBAR_ROW_CLASS,
        comfortable && '!h-[42px]',
        'group group/row w-full flex items-center transition-colors outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0',
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
          'flex-shrink-0 flex items-center transition-colors [&>svg]:size-4',
          active ? 'text-main' : 'text-tertiary group-hover:text-main',
        )}
      >
        {icon}
      </span>
      <span id={`${id}-label`} ref={containerRef} className="t-marquee flex-1 min-w-0 text-left">
        {label}
      </span>
      {badgeShown && (
        <span
          id={`${id}-badge`}
          className="flex-shrink-0 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-zViolet-500 text-white text-[11px] font-medium leading-none"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {/* One trailing slot: the row's state at rest, its actions on hover or
          focus — never both. Only the showing one takes space, so at rest the
          title runs up to the indicator, and on hover its clip edge (and fade)
          moves in to make room for the actions, as Codex does. Presses here
          must not navigate the row: activation happens at pointerdown, so they
          are fenced off. */}
      <Fenced>
        {hoverActions == null ? (
          trailing
        ) : (
          <span className="relative flex flex-shrink-0 items-center">
            <span
              id={`${id}-trailing`}
              className="flex items-center gap-1.5 group-hover:hidden group-focus-visible:hidden group-has-[:focus-visible]/row:hidden"
            >
              {trailing}
            </span>
            {/* At rest the actions are transparent and out of flow rather than
                hidden, so Tab can still reach them; focusing one reveals them. */}
            <span
              className={clsx(
                'pointer-events-none absolute right-0 flex items-center gap-1 opacity-0',
                'group-hover:pointer-events-auto group-hover:static group-hover:opacity-100',
                'group-focus-visible:pointer-events-auto group-focus-visible:static group-focus-visible:opacity-100',
                'group-has-[:focus-visible]/row:pointer-events-auto group-has-[:focus-visible]/row:static group-has-[:focus-visible]/row:opacity-100',
              )}
            >
              {hoverActions}
            </span>
          </span>
        )}
      </Fenced>
      <Fenced>{edge}</Fenced>
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
