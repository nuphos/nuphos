import { useCallback, useEffect, useRef } from 'react'

import { AUTO_SCROLL_BOTTOM_THRESHOLD } from '../agent/panel/model'

import type { RefObject } from 'react'

/**
 * Keeps a scroller at its bottom while its content grows (a post, the typing
 * bubble), as long as the reader is at or near the bottom, with the same
 * threshold a conversation uses. Scrolling up lets go; returns a jump back.
 */
export function useStickToBottom(ref: RefObject<HTMLDivElement | null>) {
  const stuck = useRef(true)

  useEffect(() => {
    const scroller = ref.current
    const content = scroller?.firstElementChild

    if (!scroller || !content) return
    const onScroll = () => {
      stuck.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <=
        AUTO_SCROLL_BOTTOM_THRESHOLD
    }
    const follow = new ResizeObserver(() => {
      if (stuck.current) scroller.scrollTop = scroller.scrollHeight
    })

    scroller.addEventListener('scroll', onScroll, { passive: true })
    follow.observe(content)

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
