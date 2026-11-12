import { Button as BaseButton } from '@base-ui/react/button'
import clsx from 'clsx'
import { useEffect, useId } from 'react'

import { useHoverMarquee } from '../hooks/useHoverMarquee'
import { useTextSwap } from '../hooks/useTextSwap'
import { t } from '../i18n'

import { Fenced, TrailingSlot } from './SidebarRowParts'
import { CountBadge } from './ui/count-badge'

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
  /** A chat-list row (Bots): name over its latest message, with the time. */
  twoLine?: boolean
  /** Comfortable chat rows: the newest message, one line under the label. */
  preview?: ReactNode
  /** The name shimmers, as running text does elsewhere (a Bot at work). */
  labelShimmer?: boolean
  /** Comfortable chat rows: when the chat was last active, at the label's right. */
  time?: string
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

function RowLabel({ label, shimmer, swap }: { label: string; shimmer: boolean; swap: boolean }) {
  if (shimmer)
    return (
      <span className="t-shimmer max-w-full truncate align-top" data-text={label}>
        {label}
      </span>
    )

  return swap ? <SwapLabel label={label} /> : <>{label}</>
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
  twoLine = false,
  preview,
  labelShimmer = false,
  time,
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
  // A chat-list row shows its state on the preview line instead, and its time here.
  const rest = twoLine
    ? time && (
        <span className="text-[11px] font-normal tabular-nums text-tertiary opacity-75">
          {time}
        </span>
      )
    : trailing
  const iconBox = icon !== null && (
    <span
      className={clsx(
        'flex-shrink-0 flex items-center transition-colors [&>svg]:size-4',
        active ? 'text-main' : 'text-tertiary group-hover:text-main',
      )}
    >
      {icon}
    </span>
  )
  const labelBox = (
    <span
      id={`${id}-label`}
      ref={containerRef}
      className={clsx(
        twoLine ? 'truncate' : 't-marquee',
        'flex-1 min-w-0 text-left leading-4',
        // The animated label is an inline-block; it carries the ellipsis itself.
        twoLine &&
          'font-medium [&>.t-text-swap]:max-w-full [&>.t-text-swap]:truncate [&>.t-text-swap]:align-top',
        revealDetail &&
          '[&>.t-text-swap]:align-top transition-transform duration-[280ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none',
      )}
      // Lifted in index.css only when the row's detail line has content.
      data-row-title={revealDetail || undefined}
    >
      <RowLabel label={label} shimmer={labelShimmer} swap={animateLabel} />
    </span>
  )
  const tail = (
    <>
      {note != null && (
        // A note that renders nothing (no phone viewing) takes no space or gap.
        <span id={`${id}-note`} className="flex flex-shrink-0 items-center empty:hidden">
          {note}
        </span>
      )}
      {badgeShown && <CountBadge id={`${id}-badge`} count={badge} />}
      {/* Presses here must not navigate the row: activation happens at
          pointerdown, so they are fenced off. */}
      <Fenced>
        <TrailingSlot
          trailingId={twoLine ? undefined : `${id}-trailing`}
          trailing={rest}
          hoverActions={hoverActions}
          overlay={twoLine}
        />
      </Fenced>
      <Fenced>{edge}</Fenced>
    </>
  )

  return (
    <BaseButton
      disabled={disabled}
      // Inside a sidebar row the row starts the scroll; restarting here would reset it.
      draggable={navigateOnRelease}
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
        twoLine && '!h-[60px] !gap-3 !rounded-xl',
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
      {twoLine ? (
        <>
          {iconBox}
          <span className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
            <span className="flex items-center gap-2 text-main">
              {labelBox}
              {tail}
            </span>
            {/* The row's state ends the preview line, as the iOS list's dot does. */}
            <span className="flex min-h-4 items-center gap-2">
              <span
                className={clsx(
                  'flex-1 min-w-0 truncate text-left text-[13px] leading-4 font-normal',
                  preview ? 'text-secondary' : 'text-tertiary',
                )}
              >
                {preview || t('No messages yet')}
              </span>
              <span id={`${id}-trailing`} className="flex-shrink-0 flex items-center">
                {trailing}
              </span>
            </span>
          </span>
        </>
      ) : (
        <>
          {iconBox}
          {labelBox}
          {tail}
        </>
      )}
    </BaseButton>
  )
}
