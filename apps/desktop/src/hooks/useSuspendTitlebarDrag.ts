import { useEffect } from 'react'

/**
 * Ref-counted so overlapping suspenders — a menu popup opened from a focused
 * search box, say — don't restore dragging while another still needs it off.
 */
let suspenders = 0

/**
 * Switch off Electron's titlebar drag regions while `active`.
 *
 * Draggable regions are computed from the layout rather than paint order, so a
 * `no-drag` element cannot carve a hole in a `titlebar-drag` strip beside or
 * under it: a press there becomes a window drag and never reaches the document.
 * Anything that has to notice an outside press — a popup dismissing itself, a
 * focused input collapsing — needs the strips off for as long as it is open.
 *
 * See the `titlebar-drag-suspended` rule in index.css.
 */
export function useSuspendTitlebarDrag(active: boolean): void {
  useEffect(() => {
    if (!active) return
    suspenders += 1
    document.documentElement.classList.add('titlebar-drag-suspended')

    return () => {
      suspenders -= 1
      if (suspenders === 0) {
        document.documentElement.classList.remove('titlebar-drag-suspended')
      }
    }
  }, [active])
}
