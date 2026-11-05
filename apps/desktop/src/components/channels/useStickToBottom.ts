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
 *
 * While it follows, the bottom is the anchor, so the browser's scroll anchoring
 * is off: when a full chat drops its oldest post as a reply lands, anchoring
 * would move the view up by that post, which reads as the reader leaving.
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
      scroller.style.overflowAnchor = stuck.current ? 'none' : ''
      lastTop = top
    }
    const follow = new ResizeObserver(() => {
      if (stuck.current) scroller.scrollTop = scroller.scrollHeight
    })

    scroller.style.overflowAnchor = stuck.current ? 'none' : ''
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
    if (!scroller) return
    scroller.style.overflowAnchor = 'none'
    scroller.scrollTop = scroller.scrollHeight
  }, [ref])
}
