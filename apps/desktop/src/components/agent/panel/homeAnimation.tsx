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

  const revealKey = `${String(delayMs)}|${shouldReduceMotion ? '1' : '0'}|${String(replayKey)}`
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

export function SparkleIcon({ className = 'size-4' }: { className?: string }) {
  const gradientId = `nuphos-agent-gradient-${useId().replace(/:/g, '')}`

  return (
    <svg
      className={className}
      fill="currentColor"
      fillRule="evenodd"
      height="1em"
      style={{ flex: 'none', lineHeight: 1 }}
      viewBox="0 0 24 24"
      width="1em"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Nuphos Agent</title>
      <path
        d="M12 24A14.304 14.304 0 000 12 14.304 14.304 0 0012 0a14.305 14.305 0 0012 12 14.305 14.305 0 00-12 12"
        fill={`url(#${gradientId})`}
        style={{ transformOrigin: 'center' }}
      />
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: 'rgb(203, 203, 255)', stopOpacity: 1 }} />
          <stop offset="50%" style={{ stopColor: 'rgb(159, 155, 246)', stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: 'rgb(243, 244, 255)', stopOpacity: 1 }} />
        </linearGradient>
      </defs>
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
