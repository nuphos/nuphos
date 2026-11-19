import { useLayoutEffect, useState } from 'react'

/** How far the bars above a composer whose top is `composerTop` reach up, in px: the room the chat's end needs. */
export function overlayReach(composerTop: number, overlayTops: readonly number[]): number {
  return Math.max(0, ...overlayTops.map((top) => Math.ceil(composerTop - top)))
}

/**
 * {@link overlayReach} of the open bars marked `data-composer-overlay` (a status banner, the reply
 * bar) inside `host`, the composer's box, kept current as they open, close, wrap or slide in. A
 * closing bar is inert and needs no room.
 */
export function useComposerOverlay(host: HTMLElement | null): number {
  const [reach, setReach] = useState(0)

  useLayoutEffect(() => {
    if (!host) return
    const bars = () => [...host.querySelectorAll<HTMLElement>('[data-composer-overlay]')]
    const measure = () =>
      setReach(
        overlayReach(
          host.getBoundingClientRect().top,
          bars()
            .filter((bar) => !bar.closest('[inert]'))
            .map((bar) => bar.getBoundingClientRect().top),
        ),
      )
    const sizes = new ResizeObserver(measure)
    const watch = () => {
      sizes.disconnect()
      for (const bar of bars()) sizes.observe(bar)
      measure()
    }
    const changes = new MutationObserver(watch)

    changes.observe(host, { subtree: true, childList: true, attributeFilter: ['inert'] })
    host.addEventListener('transitionend', measure)
    watch()

    return () => {
      sizes.disconnect()
      changes.disconnect()
      host.removeEventListener('transitionend', measure)
    }
  }, [host])

  return reach
}
