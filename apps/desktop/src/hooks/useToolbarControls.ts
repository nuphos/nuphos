import { createContext, useContext, useEffect } from 'react'

export type ToolbarSlotSide = 'left' | 'right'

/**
 * Always-present portal targets on the toolbar's controls row — the flexible,
 * shared home for per-view toolbar tools. The active view renders its own
 * controls into these with `createPortal`, which keeps ownership in the view
 * and sidesteps the re-register loops that publishing ReactNodes through App
 * state would cause (ever-fresh element identities on each render).
 *
 *   left  — sits next to the search box: filters, tabs, range / scope pickers.
 *   right — the actions region: a primary CTA and any secondary buttons.
 *
 * `setOccupied` lets a view flag that it is rendering into a side, so the
 * controls row appears even when App itself has no search or CTA — without App
 * having to special-case which pages carry their own controls.
 */
export type ToolbarSlotsValue = {
  left: HTMLElement | null
  right: HTMLElement | null
  headerRight: HTMLElement | null
  setOccupied: (side: ToolbarSlotSide, occupied: boolean) => void
  setHeaderRightOccupied: (occupied: boolean) => void
}

export const ToolbarSlotsContext = createContext<ToolbarSlotsValue>({
  left: null,
  right: null,
  headerRight: null,
  setOccupied: () => {},
  setHeaderRightOccupied: () => {},
})

/**
 * Portal a view's own controls into the toolbar's `side` region. Returns the
 * mount element while `active` (null otherwise — gate the `createPortal` on it,
 * so keep-alive'd background tabs never leak their controls into the shared
 * row). Also flags the side occupied for as long as the view is active, so the
 * controls row shows even when App has no search or CTA of its own; the flag
 * clears when the view unmounts or the tab goes inactive.
 */
export function useToolbarSlot(side: ToolbarSlotSide, active: boolean): HTMLElement | null {
  const ctx = useContext(ToolbarSlotsContext)
  const { setOccupied } = ctx

  useEffect(() => {
    if (!active) return
    setOccupied(side, true)

    return () => setOccupied(side, false)
  }, [side, active, setOccupied])

  return active ? ctx[side] : null
}

/**
 * Portal a detail view's refresh/status controls into the breadcrumb row.
 * Occupying this slot replaces the Toolbar's default refresh button; callers
 * must gate it on the active workspace tab just like the controls-row slots.
 */
export function useToolbarHeaderRightSlot(active: boolean): HTMLElement | null {
  const ctx = useContext(ToolbarSlotsContext)
  const { setHeaderRightOccupied } = ctx

  useEffect(() => {
    if (!active) return
    setHeaderRightOccupied(true)

    return () => setHeaderRightOccupied(false)
  }, [active, setHeaderRightOccupied])

  return active ? ctx.headerRight : null
}
