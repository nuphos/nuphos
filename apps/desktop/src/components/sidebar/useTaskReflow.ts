import { useLayoutEffect, useRef } from 'react'

import type { RefObject } from 'react'

type Position = { top: number; row: HTMLElement; animation?: Animation }

/** Keep one continuous move per row, across inbox/read changes and status renders. */
export function useTaskReflow(root: RefObject<HTMLElement | null>) {
  const previous = useRef(new Map<string, Position>())

  useLayoutEffect(() => {
    const list = root.current

    if (!list) return
    const listTop = list.getBoundingClientRect().top
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // Read every layout before changing animations; transformed bounds are visual, not layout.
    const measured = [...list.querySelectorAll<HTMLElement>('[data-task-reflow-key]')].map(
      (row) => {
        const key = row.dataset.taskReflowKey ?? ''
        const old = previous.current.get(key)
        const transform = old?.animation ? getComputedStyle(row).transform : 'none'
        const shift = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m42 : 0
        const top = row.getBoundingClientRect().top - listTop + list.scrollTop - shift

        return { key, row, top, shift, old }
      },
    )
    const next = new Map<string, Position>()

    for (const { key, row, top, shift, old } of measured) {
      const position: Position = { top, row }
      const unchanged = old?.row === row && Math.abs(old.top - top) < 0.5

      if (unchanged && !reduced) position.animation = old.animation
      else {
        old?.animation?.cancel()
        const dy = old ? old.top + shift - top : 0

        if (old && !reduced && Math.abs(dy) > 0.5)
          position.animation = row.animate(
            [{ transform: `translateY(${String(dy)}px)` }, { transform: 'translateY(0)' }],
            { duration: 250, easing: 'cubic-bezier(.22,1,.36,1)' },
          )
      }
      next.set(key, position)
    }
    for (const [key, old] of previous.current) if (!next.has(key)) old.animation?.cancel()
    previous.current = next
  })
  useLayoutEffect(
    () => () => {
      for (const item of previous.current.values()) item.animation?.cancel()
    },
    [],
  )
}
