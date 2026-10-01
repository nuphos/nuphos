import { motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'

import { EASE_OUT } from './progress'

// The spend line drifts up, breaks downward, settles lower. Words kept failing
// to convey that this scenario ends with the bill going down, so the chart says
// it instead — and the values are invented, which the card says out loud.
const SPEND_LINE =
  'M6 34 L34 30 L62 36 L90 26 L118 30 L146 18 L172 44 L198 54 L226 50 L254 56 L282 53'
// Where the line breaks downward — the "Nuphos found something" moment.
const SPEND_DROP = { x: 146, y: 18 }

// Draw (~1.5s) plus enough hold to read the chip before the redraw.
const SPEND_CYCLE_MS = 4500

export function SavingsPreview({ active }: { active: boolean }) {
  const reduce = useReducedMotion()
  // Looping is remount-driven: bump a key, every motion element replays its
  // initial → animate. One clock, so the line, dot, fill, and chip can't drift
  // apart the way per-element `repeat` timings would. Paused while the panel is
  // closed (it stays mounted at width 0) and skipped under reduced motion,
  // where the chart renders settled.
  const [cycle, setCycle] = useState(0)

  useEffect(() => {
    if (reduce || !active) return
    const id = window.setInterval(() => setCycle((c) => c + 1), SPEND_CYCLE_MS)

    return () => window.clearInterval(id)
  }, [reduce, active])

  return (
    <div className="mt-3 rounded-md border border-zGray-800 bg-zGray-850 p-3">
      <div className="flex items-center justify-between text-[10.5px] uppercase tracking-wider text-tertiary">
        <span>Monthly spend</span>
        <span>Example</span>
      </div>
      <div key={cycle} className="relative mt-2 text-zViolet-accent">
        <svg viewBox="0 0 288 72" className="block w-full" aria-hidden="true">
          {[18, 36, 54].map((y) => (
            <line
              key={y}
              x1="0"
              x2="288"
              y1={y}
              y2={y}
              className="stroke-zGray-800"
              strokeWidth="1"
            />
          ))}
          <defs>
            <linearGradient id="first-run-savings-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <motion.path
            d={`${SPEND_LINE} L282 72 L6 72 Z`}
            fill="url(#first-run-savings-fill)"
            stroke="none"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.1, duration: 0.4, ease: 'easeOut' }}
          />
          <motion.path
            d={SPEND_LINE}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, ease: 'easeInOut' }}
          />
          <motion.circle
            cx={SPEND_DROP.x}
            cy={SPEND_DROP.y}
            r="3.5"
            fill="currentColor"
            initial={reduce ? false : { scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            // The line reaches the break at roughly half its length.
            transition={{ delay: 0.55, duration: 0.25, ease: 'easeOut' }}
            style={{ transformOrigin: `${String(SPEND_DROP.x)}px ${String(SPEND_DROP.y)}px` }}
          />
        </svg>
        <motion.span
          className="absolute right-0 top-0 rounded bg-zViolet-500/10 px-1.5 py-0.5 text-[10.5px] font-medium"
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2, duration: 0.35, ease: EASE_OUT }}
        >
          −31% / mo
        </motion.span>
      </div>
    </div>
  )
}
