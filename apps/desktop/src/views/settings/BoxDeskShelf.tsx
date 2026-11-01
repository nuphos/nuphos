import clsx from 'clsx'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { t } from '../../i18n'

import { shelfEdges, shelfWatchKey } from './boxDeskShelfModel'

import './BoxDeskShelf.css'

import type { KeyboardEvent, ReactNode } from 'react'

// One machine's width and the gap after it: the step for the arrow buttons and keys.
const STEP_PX = 300 + 40

// Shift turns a vertical wheel sideways. Windows and Linux browsers already do this for a row that
// scrolls; macOS leaves it to the app.
function shiftWheel(event: WheelEvent) {
  const row = event.currentTarget as HTMLElement

  if (!event.shiftKey || event.deltaX !== 0 || event.deltaY === 0) return
  event.preventDefault()
  row.scrollBy({ left: event.deltaY })
}

const smooth = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'

/** The Computers desk's one row of machines. It scrolls sideways, snapping to each machine, and
 * shows which side has more: a fade on that edge and, on hover, a ‹ or › button. */
export function DeskShelf({ children }: { children: ReactNode }) {
  const row = useRef<HTMLUListElement>(null)
  const [more, setMore] = useState({ left: false, right: false })
  const watchKey = shelfWatchKey(children)

  const measure = useCallback(() => {
    const el = row.current

    if (!el) return
    const { left, right } = shelfEdges(el)

    setMore((was) => (was.left === left && was.right === right ? was : { left, right }))
  }, [])

  useEffect(() => {
    const el = row.current

    if (!el) return
    measure()
    const observer = new ResizeObserver(measure)

    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    el.addEventListener('scroll', measure, { passive: true })
    el.addEventListener('wheel', shiftWheel, { passive: false })

    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', measure)
      el.removeEventListener('wheel', shiftWheel)
    }
  }, [measure, watchKey])

  const step = (direction: -1 | 1) =>
    row.current?.scrollBy({ left: direction * STEP_PX, behavior: smooth() })

  // Only the row itself takes arrow keys; inside a machine they belong to its buttons and menus.
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      step(event.key === 'ArrowLeft' ? -1 : 1)
    }
  }

  return (
    <div className={clsx('desk-shelf', more.left && 'has-left', more.right && 'has-right')}>
      <ul
        ref={row}
        className="desk-shelf-row"
        aria-label={t('Computers')}
        // Focusable only when there is somewhere to scroll.
        tabIndex={more.left || more.right ? 0 : undefined}
        onKeyDown={onKeyDown}
      >
        {children}
      </ul>
      {more.left && (
        <button
          type="button"
          className="desk-shelf-step is-left"
          aria-label={t('Scroll computers left')}
          tabIndex={-1}
          onClick={() => step(-1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      {more.right && (
        <button
          type="button"
          className="desk-shelf-step is-right"
          aria-label={t('Scroll computers right')}
          tabIndex={-1}
          onClick={() => step(1)}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
