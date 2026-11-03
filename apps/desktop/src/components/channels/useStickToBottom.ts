import { useCallback, useEffect, useRef } from 'react'

import { AUTO_SCROLL_BOTTOM_THRESHOLD } from '../agent/panel/model'

import { stillStuck } from './followBottom'

import type { RefObject } from 'react'

/**
 * Keeps a scroller at its bottom while it or its content changes size (a post,
 * the typing bubble, an image or code block that lays out later, a taller
 * composer), as long as the reader is at or near the bottom, with the same
 * threshold a conversation uses. Only the reader scrolling up lets go
 * (stillStuck). Returns a jump back.
 */
export function useStickToBottom(ref: RefObject<HTMLDivElement | null>) {
  const stuck = useRef(true)

  useEffect(() => {
    const scroller = ref.current
    const content = scroller?.firstElementChild

    if (!scroller || !content) return
    let lastTop = scroller.scrollTop
    const onScroll = () => {
      const top = scroller.scrollTop
      const near =
        scroller.scrollHeight - top - scroller.clientHeight <= AUTO_SCROLL_BOTTOM_THRESHOLD

      stuck.current = stillStuck(stuck.current, near, top, lastTop)
      lastTop = top
    }
    const follow = new ResizeObserver(() => {
      if (stuck.current) scroller.scrollTop = scroller.scrollHeight
    })

    scroller.addEventListener('scroll', onScroll, { passive: true })
    follow.observe(content)
    follow.observe(scroller)

    return () => {
      scroller.removeEventListener('scroll', onScroll)
      follow.disconnect()
    }
  }, [ref])

  return useCallback(() => {
    const scroller = ref.current

    stuck.current = true
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }, [ref])
}
