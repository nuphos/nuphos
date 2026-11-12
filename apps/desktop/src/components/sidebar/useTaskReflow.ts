import { useLayoutEffect, useRef } from 'react'

import type { RefObject } from 'react'

type Position = { top: number; animation?: Animation }

/** Move rows across both inbox sections from their currently visible position. */
export function useTaskReflow(root: RefObject<HTMLElement | null>) {
  const previous = useRef(new Map<string, Position>())

  useLayoutEffect(() => {
    const list = root.current

    if (!list) return
    const next = new Map<string, Position>()
    const listTop = list.getBoundingClientRect().top
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    for (const row of list.querySelectorAll<HTMLElement>('[data-task-reflow-key]')) {
      const key = row.dataset.taskReflowKey ?? ''
      const old = previous.current.get(key)
      let shift = 0

      if (old?.animation) {
        const transform = getComputedStyle(row).transform

        if (transform !== 'none') shift = new DOMMatrixReadOnly(transform).m42
        old.animation.cancel()
      }
      // Relative coordinates exclude sidebar swipes and list scrolling.
      const position: Position = {
        top: row.getBoundingClientRect().top - listTop + list.scrollTop,
      }
      const dy = old ? old.top + shift - position.top : 0

      if (old && !reduced && Math.abs(dy) > 0.5) {
        position.animation = row.animate(
          [{ transform: `translateY(${String(dy)}px)` }, { transform: 'translateY(0)' }],
          { duration: 220, easing: 'cubic-bezier(.22,1,.36,1)' },
        )
      }
      next.set(key, position)
    }
    for (const old of previous.current.values()) {
      // Cancel detached rows too: a section change can replace the DOM node.
      if (old.animation && ![...next.values()].some((item) => item.animation === old.animation))
        old.animation.cancel()
    }
    previous.current = next
  })

  useLayoutEffect(
    () => () => {
      for (const item of previous.current.values()) item.animation?.cancel()
    },
    [],
  )
}
