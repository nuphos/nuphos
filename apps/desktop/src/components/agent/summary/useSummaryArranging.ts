import { useDragControls } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

import { useTabPickup } from './useSummaryPickup'

/** How long items keep gliding after a drop or a keyboard move, while they settle. */
const SETTLE_MS = 500
const DRAG_THRESHOLD = 3

export const DRAG_MOVE = {
  type: 'spring',
  stiffness: 520,
  damping: 30,
  mass: 0.8,
} as const

/**
 * Whether a list is being rearranged right now. Its items measure themselves
 * afresh when this turns on (a fold may have moved them since) and again once
 * they settle; other layout changes are not animated at all.
 */
export function useArranging() {
  const [moving, setMoving] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return {
    moving,
    /** A drag began (or a keyboard move is about to happen). */
    start: () => {
      window.clearTimeout(timer.current)
      setMoving(true)
    },
    /** The drag ended; stop gliding once the items have settled. */
    settle: () => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setMoving(false), SETTLE_MS)
    },
  }
}

/**
 * Pick up an item once the press travels a few pixels, then start its drag
 * after the list has turned dragging on (`moving`). Items carry no `drag`
 * while idle: framer re-measures a draggable item on every render, which made
 * a fold elsewhere animate the list from where it was.
 */
export function useDeferredDrag(moving: boolean, onPickUp: () => void) {
  const controls = useDragControls()
  const press = useRef<PointerEvent | null>(null)
  const pickup = useTabPickup(DRAG_THRESHOLD, (event) => {
    press.current = event
    // Let go before the drag could start: nothing to carry.
    window.addEventListener(
      'pointerup',
      () => {
        press.current = null
      },
      { once: true },
    )
    onPickUp()
  })
  const { lifted, drop } = pickup

  useEffect(() => {
    if (!lifted) return
    if (!press.current) {
      drop()

      return
    }
    if (!moving) return
    controls.start(press.current)
    press.current = null
  }, [moving, lifted, drop, controls])

  return { controls, pickup }
}
