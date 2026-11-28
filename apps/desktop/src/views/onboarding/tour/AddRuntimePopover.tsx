import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { AddableRuntimes } from './LocalRuntimes'

import type { RuntimeStatuses } from './runtimeStatuses'
import type { RefObject } from 'react'

/** The square in the card that opens and closes it; it toggles the popover itself. */
const TOGGLE = '[data-runtime-add]'
// A dialog an installer opens counts as inside it.
const EXEMPT = '[role="dialog"], [role="alertdialog"]'

/** Room it leaves above what it must not cover. */
const CLEARANCE = 12

/** Opening mirrors --duration-fast with --ease-smooth-out; closing, --duration-quick with an ease-out. */
const OPEN = { duration: 0.25, ease: [0.22, 1, 0.36, 1] } as const
const CLOSE = { duration: 0.15, ease: 'easeOut' } as const

/**
 * The runtimes that can be added, laid over the list of installed ones from its top edge without
 * moving anything. It is as tall as its rows; when they would reach `limitRef`, it rises by what
 * they lack instead of scrolling. A press outside it or Escape closes it.
 */
export function AddRuntimePopover({
  open,
  statuses,
  limitRef,
  onClose,
}: {
  open: boolean
  statuses: RuntimeStatuses
  /** What it must never cover: the page's Next. */
  limitRef: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const reduce = useReducedMotion() ?? false
  const ref = useRef<HTMLDivElement>(null)
  const [lift, setLift] = useState(0)
  const closeRef = useRef(onClose)

  useLayoutEffect(() => {
    closeRef.current = onClose
  })

  useLayoutEffect(() => {
    if (!open) return
    const fit = () => {
      // From where it rests, not where its opening motion has it now.
      const top = ref.current?.parentElement?.getBoundingClientRect().top
      const height = ref.current?.offsetHeight
      const limit = limitRef.current?.getBoundingClientRect().top

      if (top === undefined || height === undefined || limit === undefined) return
      setLift(Math.max(0, top + height + CLEARANCE - limit))
    }

    fit()
    window.addEventListener('resize', fit)

    return () => window.removeEventListener('resize', fit)
  }, [open, limitRef])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null

      if (!target || ref.current?.contains(target)) return
      if (target.closest(TOGGLE) || target.closest(EXEMPT)) return
      closeRef.current()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector(EXEMPT)) return
      // Escape closes this alone, not whatever holds it.
      event.stopPropagation()
      closeRef.current()
      document.querySelector<HTMLElement>(TOGGLE)?.focus()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          className="absolute inset-x-0 z-10 flex flex-col overflow-hidden rounded-xl border border-line-control bg-surface-sheet shadow-lg"
          style={{ top: -lift, transformOrigin: 'top center' }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: reduce ? { duration: 0 } : OPEN }}
          exit={
            reduce
              ? { opacity: 0, transition: { duration: 0 } }
              : { opacity: 0, y: -4, scale: 0.98, transition: CLOSE }
          }
        >
          <AddableRuntimes statuses={statuses} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
