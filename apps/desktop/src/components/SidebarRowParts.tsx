import clsx from 'clsx'

import type { ReactNode } from 'react'

/**
 * One trailing slot: the row's state at rest, its actions on hover or focus,
 * never both. Only the showing one takes space, so at rest the title runs up to
 * the indicator, and on hover its clip edge moves in to make room for the actions.
 */
export function TrailingSlot({
  trailingId,
  trailing,
  hoverActions,
  overlay = false,
}: {
  trailingId?: string
  trailing?: ReactNode
  hoverActions?: ReactNode
  /**
   * The actions cover the resting state instead of replacing it, so nothing in
   * the row moves on hover (a Bots row's time and preview).
   */
  overlay?: boolean
}) {
  return hoverActions == null ? (
    trailing
  ) : (
    // The slot gives back the row's gap and carries its own leading space only
    // while it shows something, so an idle row's title runs to the edge.
    <span className="relative -ml-2.5 flex flex-shrink-0 items-center">
      <span
        id={trailingId}
        className={clsx(
          'sidebar-swap-in flex items-center gap-1.5',
          'empty:hidden [&:not(:empty)]:pl-2.5',
          overlay
            ? 'group-hover:invisible group-focus-visible:invisible group-has-[:focus-visible]/row:invisible group-has-[[aria-expanded=true]]/row:invisible'
            : 'group-hover:hidden group-focus-visible:hidden group-has-[:focus-visible]/row:hidden group-has-[[aria-expanded=true]]/row:hidden',
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
          overlay && 'inset-y-0',
          'group-hover:animate-[sidebar-swap-in_200ms_cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:animate-none',
          'group-hover:pointer-events-auto group-hover:opacity-100',
          'group-focus-visible:pointer-events-auto group-focus-visible:opacity-100',
          'group-has-[:focus-visible]/row:pointer-events-auto group-has-[:focus-visible]/row:opacity-100',
          // An action whose menu is open stays put as the menu's anchor.
          'group-has-[[aria-expanded=true]]/row:pointer-events-auto group-has-[[aria-expanded=true]]/row:opacity-100',
          !overlay &&
            'group-hover:static group-focus-visible:static group-has-[:focus-visible]/row:static group-has-[[aria-expanded=true]]/row:static',
        )}
      >
        {hoverActions}
      </span>
    </span>
  )
}

/** Keeps presses inside from reaching the row's pointerdown navigation. */
export function Fenced({ className = 'contents', children }: { className?: string; children: ReactNode }) {
  if (children == null) return null

  return (
    <span className={className} onPointerDown={(event) => event.stopPropagation()}>
      {children}
    </span>
  )
}
