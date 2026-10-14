import { useCallback, useEffect, useRef, useState } from 'react'

import type { RailTurn } from './railTurns'
import type { RefObject } from 'react'

// The "reading line": a turn is active while one of its messages crosses the
// band between 15% and 45% of the viewport height.
const ACTIVE_BAND = '-15% 0px -55% 0px'
const JUMP_OFFSET = 16
// After a jump the clicked turn stays active while the scroll settles, even
// when the transcript bottoms out before that turn reaches the top.
const JUMP_PIN_MS = 300

function findMessage(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)
}

function isAtBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 8
}

/**
 * Tracks the turn in view and scrolls to a turn on request. Element lookups
 * happen in effects and handlers only, never during render, so the deferred
 * message paint (DEFERRED_MESSAGE_STYLE) stays deferred.
 */
export function useTurnRail(
  scrollRef: RefObject<HTMLDivElement | null>,
  turns: RailTurn[],
  onBeforeJump: () => void,
) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const pinnedUntilRef = useRef(0)
  // Re-observe only when the set of messages changes, not on streaming text.
  const idsKey = turns.map((t) => t.messageIds.join(',')).join('|')

  useEffect(() => {
    const root = scrollRef.current

    if (!root || turns.length === 0) return
    const turnOf = new Map<string, number>()

    turns.forEach((turn, i) => turn.messageIds.forEach((id) => turnOf.set(id, i)))
    const inBand = new Set<string>()
    const pick = () => {
      if (performance.now() < pinnedUntilRef.current) return
      if (isAtBottom(root)) return setActiveId(turns[turns.length - 1].id)
      let top = Infinity

      for (const id of inBand) top = Math.min(top, turnOf.get(id) ?? Infinity)
      if (top !== Infinity) setActiveId(turns[top].id)
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.messageId ?? ''

          if (entry.isIntersecting) inBand.add(id)
          else inBand.delete(id)
        }
        pick()
      },
      { root, rootMargin: ACTIVE_BAND },
    )

    for (const id of turnOf.keys()) {
      const el = findMessage(root, id)

      if (el) observer.observe(el)
    }
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(pick)
    }

    root.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      observer.disconnect()
      root.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idsKey covers turns
  }, [idsKey, scrollRef])

  const jumpTo = useCallback(
    (id: string) => {
      const root = scrollRef.current

      if (!root) return
      const align = () => {
        const el = findMessage(root, id)

        if (!el) return
        const offset = el.getBoundingClientRect().top - root.getBoundingClientRect().top

        root.scrollTop += offset - JUMP_OFFSET
      }

      onBeforeJump()
      pinnedUntilRef.current = performance.now() + JUMP_PIN_MS
      setActiveId(id)
      align()
      // Deferred messages swap their placeholder height for the real one once
      // they paint, which shifts the target; settle on the next frame.
      requestAnimationFrame(align)
    },
    [onBeforeJump, scrollRef],
  )

  return { activeId, jumpTo }
}
