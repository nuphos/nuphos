import { useCallback } from 'react'

/**
 * transitions.dev "Card resize" for content whose height changes on its own
 * (a step swap, a phase change). Ref the inner element: its `.t-resize`
 * parent is pinned to the inner's measured height, so changes tween instead
 * of jumping. A callback ref, so it also works for content that mounts late.
 */
export function useAutoHeight<T extends HTMLElement>() {
  return useCallback((inner: T | null) => {
    const outer = inner?.parentElement

    if (!inner || !outer) return
    const fit = () => {
      outer.style.height = `${String(inner.offsetHeight)}px`
    }

    // First paint: write the height without a transition so it doesn't grow in from 0.
    outer.style.transition = 'none'
    fit()
    outer.getBoundingClientRect()
    outer.style.transition = ''
    const observer = new ResizeObserver(fit)

    observer.observe(inner)

    return () => observer.disconnect()
  }, [])
}
