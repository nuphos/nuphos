import confetti from 'canvas-confetti'
import { useReducedMotion } from 'framer-motion'
import { useEffect, useRef } from 'react'

import { cssTripletToHex, landingBurstShots } from '../lib/confetti'

// Theme-aware palette: `index.css` defines these as "R, G, B" triplets (the
// tailwind `withOpacity` convention), and the light theme overrides them, so
// reading the computed values at mount keeps the burst on-brand in both themes.
const PALETTE_VARS = [
  '--color-zViolet-accent',
  '--color-zViolet-300',
  '--color-zViolet-400',
  '--color-zBlue-400',
  '--color-zBlue-accent',
  '--color-zOrangered-400',
]

/**
 * One-shot, full-screen celebration burst. Mount it to play; it calls `onDone`
 * when the last particle is gone (immediately under reduced motion) so the
 * parent can unmount it. Purely decorative: never intercepts pointer events.
 */
export function ConfettiBurst({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const reduce = useReducedMotion()
  // Both completion paths fire `onDone` from inside an effect; the ref keeps
  // them on the latest callback without restarting the burst when the parent
  // re-renders with a new closure.
  const onDoneRef = useRef(onDone)

  useEffect(() => {
    onDoneRef.current = onDone
  })

  useEffect(() => {
    if (reduce) {
      onDoneRef.current()

      return
    }
    const canvas = canvasRef.current

    if (!canvas) {
      onDoneRef.current()

      return
    }

    // Bound to our own canvas (rather than the library's auto-appended one) so
    // the overlay's stacking and pointer-events stay under our control.
    const fire = confetti.create(canvas, { resize: true, useWorker: true })
    const rootStyle = getComputedStyle(document.documentElement)
    const colors = PALETTE_VARS.map((v) => cssTripletToHex(rootStyle.getPropertyValue(v))).filter(
      (hex): hex is string => hex !== null,
    )
    let cancelled = false

    void Promise.all(
      landingBurstShots().map(
        // `fire` yields null (not a promise) only when the library refuses to
        // animate; normalize so the aggregate still settles and fires onDone.
        (shot) =>
          fire({ ...shot, colors: colors.length > 0 ? colors : undefined }) ??
          Promise.resolve(null),
      ),
    ).then(() => {
      if (!cancelled) onDoneRef.current()
    })

    return () => {
      cancelled = true
      fire.reset()
    }
  }, [reduce])

  if (reduce) return null

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-50 h-full w-full pointer-events-none"
      aria-hidden="true"
    />
  )
}
