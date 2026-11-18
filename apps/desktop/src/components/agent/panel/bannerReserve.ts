import { useEffect, useLayoutEffect } from 'react'

import type { RefObject } from 'react'

/**
 * Marks the element that holds both the transcript and the composer. The agent
 * status banner floats above the composer, out of flow so the input never moves,
 * and writes its height here so the transcript can leave room for it (#3567).
 */
export const BANNER_HOST = 'data-agent-status-host'
export const BANNER_HEIGHT_VAR = '--agent-status-banner-height'

/** Publishes the banner's height to its host while it is open, and 0 while it is not. */
export function useReserveBannerHeight(ref: RefObject<HTMLElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const banner = ref.current
    const host = banner?.closest<HTMLElement>(`[${BANNER_HOST}]`)

    if (!banner || !host) return
    const update = () =>
      host.style.setProperty(BANNER_HEIGHT_VAR, `${String(open ? banner.offsetHeight : 0)}px`)
    // A long reason wraps and the tab grows upward.
    const observer = new ResizeObserver(update)

    observer.observe(banner)
    update()

    return () => {
      observer.disconnect()
      host.style.removeProperty(BANNER_HEIGHT_VAR)
    }
  }, [ref, open])
}

/**
 * A transcript that was following the latest message keeps following it when
 * its own box shrinks, as when the banner's room is added below the messages.
 */
export function useFollowOnResize(ref: RefObject<HTMLElement | null>, following: () => boolean) {
  useEffect(() => {
    const element = ref.current

    if (!element) return
    const observer = new ResizeObserver(() => {
      if (following()) element.scrollTop = element.scrollHeight
    })

    observer.observe(element)

    return () => observer.disconnect()
  }, [ref, following])
}
