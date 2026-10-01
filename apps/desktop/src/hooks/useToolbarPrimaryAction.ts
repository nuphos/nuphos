import { createContext, useContext, useEffect, useInsertionEffect, useRef } from 'react'

export type ToolbarPrimaryAction = {
  label: string
  onClick: () => void
  disabled?: boolean
}

/**
 * Lets the active list view publish a single primary action (e.g. "Create
 * bucket") to the global toolbar's filter row, instead of rendering a separate
 * per-view action bar that duplicates the title/count already shown in the
 * breadcrumb and search box. App provides the registrar; the view registers via
 * useToolbarPrimaryAction below.
 *
 * This is the ergonomic path for the common "one primary CTA" case. For richer
 * or secondary controls — filters, tabs, range/scope pickers, extra buttons —
 * use the portal slots from `useToolbarControls` (`useToolbarSlots().left` /
 * `.right`) and render into them from the view. Do NOT hand-roll a per-view
 * header band for those; that rebuilds exactly the stacked bar this removed.
 */
export const ToolbarPrimaryActionContext = createContext<
  ((action: ToolbarPrimaryAction | null) => void) | null
>(null)

/**
 * Publish a primary action to the toolbar while this view is mounted. Pass a
 * null label to publish nothing (e.g. while drilled into a detail view). The
 * handler is read fresh on each click, so callers need not memoize it. Pass
 * `disabled` to grey the button out while the action is in flight.
 */
export function useToolbarPrimaryAction(
  label: string | null,
  onClick: () => void,
  disabled = false,
): void {
  const register = useContext(ToolbarPrimaryActionContext)
  const onClickRef = useRef(onClick)

  useInsertionEffect(() => {
    onClickRef.current = onClick
  })
  useEffect(() => {
    if (!register || !label) return
    register({ label, onClick: () => onClickRef.current(), disabled })

    return () => register(null)
  }, [register, label, disabled])
}
