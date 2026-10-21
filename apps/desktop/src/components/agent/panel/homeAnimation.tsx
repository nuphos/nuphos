import clsx from 'clsx'
import { motion, useReducedMotion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { PRESETS } from './stall'
import { getAgentLocale } from './textUtils'

import type { ReactNode } from 'react'

function splitForAnimation(text: string, lang: string): string[] {
  try {
    const isCJK = /^(zh|ja|ko)/i.test(lang)
    const SegmenterCtor = (
      Intl as unknown as {
        Segmenter?: new (
          l: string,
          opts: { granularity: 'grapheme' | 'word' },
        ) => { segment(s: string): Iterable<{ segment: string }> }
      }
    ).Segmenter

    if (!SegmenterCtor) {
      return isCJK ? Array.from(text) : text.split(/(\s+)/)
    }
    const segmenter = new SegmenterCtor(lang, {
      granularity: isCJK ? 'grapheme' : 'word',
    })

    return Array.from(segmenter.segment(text), (s) => s.segment)
  } catch {
    return text.split(/(\s+)/)
  }
}

export function AgentHomeAnimation({ title = 'What should we work on?' }: { title?: string }) {
  const segments = splitForAnimation(title, getAgentLocale() ?? navigator.language ?? 'en')
  const shouldReduceMotion = useReducedMotion()
  const titleStart = 0.45
  const titlePerToken = 0.05
  const easeOut = [0.22, 1, 0.36, 1] as const

  return (
    <div className="mb-5 flex flex-col items-start gap-y-4">
      <motion.div
        initial={
          shouldReduceMotion
            ? { opacity: 0 }
            : { opacity: 0, x: -18, rotate: -180, filter: 'blur(8px)' }
        }
        animate={
          shouldReduceMotion ? { opacity: 1 } : { opacity: 1, x: 0, rotate: 0, filter: 'blur(0px)' }
        }
        transition={
          shouldReduceMotion
            ? { duration: 0.18, ease: easeOut }
            : {
                duration: 0.6,
                ease: easeOut,
              }
        }
        className="origin-center"
      >
        <SparkleIcon className="size-9" />
      </motion.div>

      <span className="text-lg font-semibold leading-snug text-main" aria-label={title}>
        {segments.map((segment, index) => (
          <motion.span
            key={`${String(index)}-${segment}`}
            initial={{ opacity: 0, y: 8, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{
              delay: titleStart + index * titlePerToken,
              duration: 0.35,
              ease: easeOut,
            }}
            style={{ display: 'inline-block', whiteSpace: 'pre' }}
            aria-hidden
          >
            {segment}
          </motion.span>
        ))}
      </span>
    </div>
  )
}

/** When the composer slides in after the greeting; later blocks key off it. */
export const COMPOSER_REVEAL_MS = 520

export function DelayedPanelReveal({
  children,
  className,
  delayMs = COMPOSER_REVEAL_MS,
  replayKey = 0,
}: {
  children: ReactNode
  className?: string
  delayMs?: number
  /** A new value replays the reveal without remounting `children`. */
  replayKey?: number
}) {
  const shouldReduceMotion = useReducedMotion()
  const [open, setOpen] = useState(() => Boolean(shouldReduceMotion))

  // Only a new replayKey (or a motion preference change) replays the reveal; a
  // block whose delay moves, as a card's does when one before it goes, stays.
  const revealKey = `${shouldReduceMotion ? '1' : '0'}|${String(replayKey)}`
  const [revealedFor, setRevealedFor] = useState(revealKey)

  if (revealKey !== revealedFor) {
    setRevealedFor(revealKey)
    setOpen(Boolean(shouldReduceMotion))
  }

  useEffect(() => {
    if (shouldReduceMotion) return
    const timer = window.setTimeout(() => setOpen(true), delayMs)

    return () => window.clearTimeout(timer)
  }, [delayMs, shouldReduceMotion, replayKey])

  return (
    <div
      className={clsx('t-panel-slide t-agent-composer-reveal', className)}
      data-open={open ? 'true' : 'false'}
    >
      {children}
    </div>
  )
}

const STAR =
  'M12 24A14.304 14.304 0 000 12 14.304 14.304 0 0012 0a14.305 14.305 0 0012 12 14.305 14.305 0 00-12 12'

// A pearl glass core over an iridescent sheen; it reads well on both themes.
const STAR_LOOK = {
  sheen: ['#e879f9', '#8b5cf6', '#22d3ee', '#fb7185', '#fbbf24'],
  core: [
    ['#ffffff', 0.95],
    ['#f5f3ff', 0.85],
    ['#ede9fe', 0.75],
  ],
  glow: { color: '#7c3aed', opacity: 0.28, dy: 0.6 },
  shine: [0.9, 0.6],
} as const

/**
 * The agent's mark as a glossy holographic star: a glassy core over a slowly
 * shifting violet–cyan–rose sheen, two soft highlights and a violet glow.
 * The sheen holds still when the system asks for reduced motion.
 */
export function SparkleIcon({ className = 'size-4' }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  const still = useReducedMotion()
  const palette = STAR_LOOK

  return (
    <svg
      className={className}
      height="1em"
      shapeRendering="geometricPrecision"
      style={{ flex: 'none', lineHeight: 1, overflow: 'visible' }}
      viewBox="0 0 24 24"
      width="1em"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Nuphos Agent</title>
      <defs>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="1">
          {palette.sheen.map((color, index) => (
            <stop key={color} offset={`${String(index * 25)}%`} stopColor={color} />
          ))}
          {!still && (
            <animateTransform
              attributeName="gradientTransform"
              type="rotate"
              values="0 0.5 0.5;360 0.5 0.5"
              dur="9s"
              repeatCount="indefinite"
            />
          )}
        </linearGradient>
        <radialGradient id={`${id}-core`} cx="0.42" cy="0.38" r="0.62">
          {palette.core.map(([color, opacity], index) => (
            <stop
              key={color}
              offset={['0%', '55%', '100%'][index]}
              stopColor={color}
              stopOpacity={opacity}
            />
          ))}
        </radialGradient>
        <radialGradient id={`${id}-shine`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        {/* A mask, not a clipPath: Chromium anti-aliases mask edges but cuts clip edges hard. */}
        <mask id={`${id}-cut`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <path d={STAR} fill="#fff" />
        </mask>
        <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
        <filter id={`${id}-glow`} x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow
            dx="0"
            dy={palette.glow.dy}
            stdDeviation="1.4"
            floodColor={palette.glow.color}
            floodOpacity={palette.glow.opacity}
          />
        </filter>
      </defs>
      <g filter={`url(#${id}-glow)`}>
        <g mask={`url(#${id}-cut)`}>
          <path d={STAR} fill={`url(#${id}-sheen)`} />
          <path
            d={STAR}
            fill={`url(#${id}-core)`}
            filter={`url(#${id}-soft)`}
            transform="translate(12 12) scale(0.72) translate(-12 -12)"
          />
          <ellipse
            cx="9.6"
            cy="9.2"
            rx="2.6"
            ry="1"
            transform="rotate(-45 9.6 9.2)"
            fill={`url(#${id}-shine)`}
            opacity={palette.shine[0]}
          />
          <ellipse
            cx="15.2"
            cy="15.6"
            rx="1.5"
            ry="0.55"
            transform="rotate(-45 15.2 15.6)"
            fill={`url(#${id}-shine)`}
            opacity={palette.shine[1]}
          />
        </g>
      </g>
    </svg>
  )
}

export function Welcome({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex-1 flex flex-col px-2.5 py-6 overflow-auto scrollbar-thin selectable">
      {/* The rows below carry their own `px-3` inside the button, so the
          heading needs it too — otherwise the title starts 12px left of every
          line under it. */}
      <div className="px-3">
        <AgentHomeAnimation />
      </div>
      <div className="space-y-1">
        {PRESETS.map((p, i) => {
          const Icon = p.icon

          return (
            <button
              key={i}
              onClick={() => onPick(p.prompt)}
              className="w-full text-left px-3 py-2 rounded-md hover:bg-zGray-800/60 transition-colors flex items-center gap-3 group"
            >
              <Icon className="w-4 h-4 text-tertiary flex-shrink-0" strokeWidth={1.8} />
              <span className="text-[13px] text-secondary group-hover:text-main truncate">
                {p.title}
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-tertiary opacity-0 group-hover:opacity-100 ml-auto flex-shrink-0" />
            </button>
          )
        })}
      </div>
      {/* The app sidebar carries this row too, but it can be collapsed out of
          sight — and a docked panel is exactly when it usually is. */}
    </div>
  )
}
