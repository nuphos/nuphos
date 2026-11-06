import clsx from 'clsx'
import { useCallback, useEffect, useRef } from 'react'

import type { ComponentProps } from 'react'

/**
 * The area under a fixed header. While the scroller pressed against the header
 * is scrolled, content fades out over the top edge instead of being cut off by
 * an invisible line; at the top there is nothing, so header and content read as
 * one sheet. Scrollers further down (a nested list) don't count.
 */
export function HeaderEdge({ className, ref, ...props }: ComponentProps<'div'>) {
  const local = useRef<HTMLDivElement | null>(null)
  // The caller may need the element too (a channel scrolls its own list).
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      local.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref],
  )

  useEffect(() => {
    const edge = local.current

    if (!edge) return
    const onScroll = (event: Event) => {
      const scroller = event.target

      if (!(scroller instanceof HTMLElement)) return
      if (scroller.getBoundingClientRect().top - edge.getBoundingClientRect().top > 1) return
      edge.toggleAttribute('data-scrolled', scroller.scrollTop > 0)
    }

    // Scroll events don't bubble; capture sees every scroller inside.
    edge.addEventListener('scroll', onScroll, { capture: true, passive: true })

    return () => edge.removeEventListener('scroll', onScroll, { capture: true })
  }, [])

  return <div ref={setRef} className={clsx('header-edge', className)} {...props} />
}
