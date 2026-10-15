import { useCallback, useEffect, useState } from 'react'

import type { RailTurn } from './railTurns'
import type { RefObject } from 'react'

// A message this far under the top edge no longer counts as in view, so a
// turn scrolled just past the header stops lighting its tick.
const VIEW_INSET = 16
const JUMP_OFFSET = 16
// Gives up on the post-jump correction if the scroll never reports its end.
const SETTLE_TIMEOUT_MS = 1000
const NONE: ReadonlySet<string> = new Set()

function findMessage(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id))
}

/**
 * Tracks which turns are on screen and scrolls to a turn on request. Element
 * lookups happen in effects and handlers only, never during render, so the
 * deferred message paint (DEFERRED_MESSAGE_STYLE) stays deferred.
 */
export function useTurnRail(
  scrollRef: RefObject<HTMLDivElement | null>,
  turns: RailTurn[],
  onBeforeJump: () => void,
) {
  const [inView, setInView] = useState<ReadonlySet<string>>(NONE)
  // Re-observe only when the set of messages changes, not on streaming text.
  const idsKey = turns.map((t) => t.messageIds.join(',')).join('|')

  useEffect(() => {
    const root = scrollRef.current

    if (!root || turns.length === 0) return
    const turnOf = new Map<string, number>()

    turns.forEach((turn, i) => turn.messageIds.forEach((id) => turnOf.set(id, i)))
    const visible = new Set<string>()
    // Every turn from the first visible message to the last one, so a reply
    // taller than the viewport keeps its turn lit while it scrolls past.
    const pick = () => {
      let first = Infinity
      let last = -1

      for (const id of visible) {
        const i = turnOf.get(id) ?? -1

        first = Math.min(first, i)
        last = Math.max(last, i)
      }
      if (last < 0) return
      const next = new Set(turns.slice(first, last + 1).map((t) => t.id))

      setInView((prev) => (sameIds(prev, next) ? prev : next))
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.messageId ?? ''

          if (entry.isIntersecting) visible.add(id)
          else visible.delete(id)
        }
        pick()
      },
      { root, rootMargin: `-${String(VIEW_INSET)}px 0px 0px 0px` },
    )

    for (const id of turnOf.keys()) {
      const el = findMessage(root, id)

      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idsKey covers turns
  }, [idsKey, scrollRef])

  const jumpTo = useCallback(
    (id: string) => {
      const root = scrollRef.current
      const el = root && findMessage(root, id)

      if (!root || !el) return
      const align = () => {
        const offset = el.getBoundingClientRect().top - root.getBoundingClientRect().top

        root.scrollTo({ top: root.scrollTop + offset - JUMP_OFFSET, behavior: 'instant' })
      }
      const distance =
        el.getBoundingClientRect().top - root.getBoundingClientRect().top - JUMP_OFFSET

      onBeforeJump()
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(distance) < 1) {
        align()
        // Deferred messages swap their placeholder height for the real one
        // once they paint, which shifts the target; settle on the next frame.
        requestAnimationFrame(align)

        return
      }
      // The same shift happens while gliding past deferred messages, so land
      // on the target once the scroll stops, unless the reader took over:
      // any wheel, touch, key or click (Jump to latest, the scrollbar, another
      // tick) drops the correction.
      const intents = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
      const done = (event: Event) => {
        window.clearTimeout(timer)
        root.removeEventListener('scrollend', done)
        for (const intent of intents) window.removeEventListener(intent, done, true)
        if (event.type === 'scrollend') align()
      }
      const timer = window.setTimeout(() => done(new Event('scrollend')), SETTLE_TIMEOUT_MS)

      root.addEventListener('scrollend', done)
      for (const intent of intents) {
        window.addEventListener(intent, done, { capture: true, passive: true })
      }
      root.scrollTo({ top: root.scrollTop + distance, behavior: 'smooth' })
    },
    [onBeforeJump, scrollRef],
  )

  return { inView, jumpTo }
}
