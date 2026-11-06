import { Button as BaseButton } from '@base-ui/react/button'
import clsx from 'clsx'
import { useEffect, useId } from 'react'

import { useHoverMarquee } from '../hooks/useHoverMarquee'
import { useTextSwap } from '../hooks/useTextSwap'

import type { LucideIcon } from 'lucide-react'
import type React from 'react'
import type { ReactNode } from 'react'

export const SIDEBAR_PANEL_PADDING_CLASS = 'px-2.5 pb-5'
// One row height for the whole sidebar (design system: 36px rows, 4px apart).
export const SIDEBAR_ROW_CLASS = 'h-9 px-2 gap-2.5 rounded-lg text-[14px] font-[450]'
export const SIDEBAR_GROUP_GAP_CLASS = 'mb-5'
export const SIDEBAR_GROUP_ITEMS_CLASS = 'space-y-1'
export const SIDEBAR_GROUP_TITLE_CLASS = 'px-2 pt-1.5 pb-1 text-[13px] text-tertiary font-medium'

export function SidebarNavIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.8} />
}

type SidebarNavItemProps = {
  /**
   * Icon element sized by the caller (e.g. `w-3.5 h-3.5`). Its color follows the
   * active/hover state via `currentColor` — pass no color class to inherit it,
   * or set an explicit color class to opt out (e.g. always-tertiary badges).
   * `null` leaves the row without a leading mark (a task is its title).
   */
  icon: ReactNode | null
  label: string
  active: boolean
  sharedBackground?: boolean
  /** Receives the event so callers can honour cmd/ctrl-click (open in a new tab). */
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  /** Optional count rendered as a small badge to the right of the label. */
  badge?: number
  /** Quiet text right after the label, part of the row's name (a done count). */
  note?: ReactNode
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
  /** Cross-fade the label when it changes in place (e.g. a renamed chat). */
  animateLabel?: boolean
  /**
   * The row has a detail line below it (see SessionRowSurface). The label lifts
   * to make room while the row is hovered or focused; the row keeps its height.
   */
  revealDetail?: boolean
}

function SwapLabel({ label }: { label: string }) {
  const { ref, text } = useTextSwap<HTMLSpanElement>(label)

  return (
    <span ref={ref} className="t-text-swap">
      {text}
    </span>
  )
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
  note,
  trailing,
  edge,
  hoverActions,
  navigateOnRelease = false,
  comfortable = false,
  animateLabel = false,
  revealDetail = false,
}: SidebarNavItemProps) {
  const { containerRef, start, stop } = useHoverMarquee<HTMLSpanElement>(label)

  // A row that owns more than this button (a detail line, its own actions) is
  // the hover target as a whole: the title scrolls wherever the pointer rests.
  useEffect(() => {
    const row = containerRef.current?.closest<HTMLElement>('[data-sidebar-row]')

    if (!row) return
    row.addEventListener('pointerenter', start)
    row.addEventListener('pointerleave', stop)

    return () => {
      row.removeEventListener('pointerenter', start)
      row.removeEventListener('pointerleave', stop)
    }
  }, [containerRef, start, stop])
  const id = useId()
  const badgeShown = badge !== undefined && badge > 0

  return (
    <BaseButton
      disabled={disabled}
      // Inside a sidebar row the row starts the scroll; restarting here would reset it.
      onPointerEnter={(event) => {
        if (!event.currentTarget.closest('[data-sidebar-row]')) start()
      }}
      onPointerLeave={(event) => {
        if (!event.currentTarget.closest('[data-sidebar-row]')) stop()
      }}
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
          : [
              `${id}-label`,
              note != null && `${id}-note`,
              badgeShown && `${id}-badge`,
              `${id}-trailing`,
            ]
              .filter(Boolean)
              .join(' ')
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
              ? // A conversation's title is its identity; it reads at full strength.
                'text-primary'
              : 'text-secondary hover:bg-[var(--sidebar-overlay-hover)]',
      )}
    >
      {icon !== null && (
        <span
          className={clsx(
            'flex-shrink-0 flex items-center transition-colors [&>svg]:size-4',
            active ? 'text-main' : 'text-tertiary group-hover:text-main',
          )}
        >
          {icon}
        </span>
      )}
      <span
        id={`${id}-label`}
        ref={containerRef}
        className={clsx(
          't-marquee flex-1 min-w-0 text-left leading-4',
          revealDetail &&
            'transition-transform duration-[280ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none',
        )}
        // Lifted in index.css only when the row's detail line has content.
        data-row-title={revealDetail || undefined}
      >
        {animateLabel ? <SwapLabel label={label} /> : label}
      </span>
      {note != null && (
        // A note that renders nothing (no phone viewing) takes no space or gap.
        <span id={`${id}-note`} className="flex flex-shrink-0 items-center empty:hidden">
          {note}
        </span>
      )}
      {badgeShown && (
        <span
          id={`${id}-badge`}
          className="flex-shrink-0 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-status-attention text-inverse text-[11px] font-medium leading-none"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {/* Presses here must not navigate the row: activation happens at
          pointerdown, so they are fenced off. */}
      <Fenced>
        <TrailingSlot id={id} trailing={trailing} hoverActions={hoverActions} />
      </Fenced>
      <Fenced>{edge}</Fenced>
    </BaseButton>
  )
}

/**
 * One trailing slot: the row's state at rest, its actions on hover or focus,
 * never both. Only the showing one takes space, so at rest the title runs up to
 * the indicator, and on hover its clip edge moves in to make room for the actions.
 */
function TrailingSlot({
  id,
  trailing,
  hoverActions,
}: {
  id: string
  trailing?: ReactNode
  hoverActions?: ReactNode
}) {
  return hoverActions == null ? (
    trailing
  ) : (
    // The slot gives back the row's gap and carries its own leading space only
    // while it shows something, so an idle row's title runs to the edge.
    <span className="relative -ml-2.5 flex flex-shrink-0 items-center">
      <span
        id={`${id}-trailing`}
        className={clsx(
          'sidebar-swap-in flex items-center gap-1.5 group-hover:hidden group-focus-visible:hidden',
          'empty:hidden [&:not(:empty)]:pl-2.5',
          'group-has-[:focus-visible]/row:hidden group-has-[[aria-expanded=true]]/row:hidden',
        )}
      >
        {trailing}
      </span>
      {/* At rest the actions are transparent and out of flow rather than
            hidden, so Tab can still reach them; focusing one reveals them. */}
      <span
        className={clsx(
          // Always mounted (Tab must reach it), so the slide plays on hover, not on mount.
          'pointer-events-none absolute right-0 flex items-center gap-1 pl-2.5 opacity-0',
          'group-hover:animate-[sidebar-swap-in_200ms_cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:animate-none',
          'group-hover:pointer-events-auto group-hover:static group-hover:opacity-100',
          'group-focus-visible:pointer-events-auto group-focus-visible:static group-focus-visible:opacity-100',
          'group-has-[:focus-visible]/row:pointer-events-auto group-has-[:focus-visible]/row:static group-has-[:focus-visible]/row:opacity-100',
          // An action whose menu is open stays put as the menu's anchor.
          'group-has-[[aria-expanded=true]]/row:pointer-events-auto group-has-[[aria-expanded=true]]/row:static group-has-[[aria-expanded=true]]/row:opacity-100',
        )}
      >
        {hoverActions}
      </span>
    </span>
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
