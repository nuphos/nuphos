import { Collapsible } from '@base-ui/react/collapsible'
import clsx from 'clsx'
import { Brain, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useTextSwap } from '../../../hooks/useTextSwap'

import { formatWorkDuration } from './streamText'

import type { ToolPart } from './parts'
import type { ReactNode } from 'react'

export const disclosureControlClass =
  '-mx-1.5 rounded-md px-1.5 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zViolet-accent/60'

/**
 * Extended thinking: a shimmer line while the model is mid-
 * thought, a folded "Thinking" disclosure once the block is complete —
 * same visual language as the journal panel's Reasoning fold.
 */
export function ThinkingPartView({ text, live }: { text: string; live: boolean }) {
  // While mid-thought the bottom-of-transcript status row already shows
  // "Thinking… {Ns}" (with a timer) for this same reasoning step, so an inline
  // live "Thinking" here just stacked a second, timer-less duplicate on top of
  // it. Render only the folded disclosure once the block is complete.
  if (live) return null
  if (!text.trim()) return null

  return (
    <Collapsible.Root>
      <Collapsible.Trigger
        className={clsx(
          disclosureControlClass,
          'group inline-flex items-center gap-1 text-[11px] text-tertiary hover:text-main/80',
        )}
      >
        <ChevronRight
          className="h-3 w-3 transition-transform group-data-[panel-open]:rotate-90"
          strokeWidth={2}
        />
        <Brain className="h-3 w-3" strokeWidth={2} />
        Thinking
      </Collapsible.Trigger>
      <Collapsible.Panel className="mt-1 whitespace-pre-wrap break-words border-l-2 border-zGray-800 pl-2.5 text-[12px] italic leading-5 text-main/60">
        {text}
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

// Codex-style turn fold: once a turn finishes cleanly, its work log
// (narration, tool runs, thinking) folds behind a "Worked for Xs" disclosure
// and only the final answer stays visible. Turns that ended abnormally —
// pending approval, interrupted, still running — never reach this view and
// stay fully expanded, which itself signals "this one needs attention".
export function CollapsedWorkView({
  seconds,
  children,
}: {
  seconds: number | null
  /** Render work only after disclosure. Historical tool output can be several
   * megabytes, so CSS-only hiding still blocks conversation open on its DOM. */
  children: () => ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <div>
      {/* Chapter-style header: label + full-width rule, like Codex's
          "Worked for Xs" separator between a turn's request and answer. */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onPointerDown={(event) => {
            if (event.button !== 0) return
            setOpen((o) => !o)
          }}
          onClick={(event) => {
            if (event.detail !== 0) return
            setOpen((o) => !o)
          }}
          aria-expanded={open}
          className={clsx(
            disclosureControlClass,
            'inline-flex flex-shrink-0 items-center gap-1 text-[13px] text-tertiary hover:text-main/80',
          )}
        >
          {seconds === null ? 'Worked' : `Worked for ${formatWorkDuration(seconds)}`}
          <ChevronRight
            className={clsx('h-3.5 w-3.5 transition-transform', open && 'rotate-90')}
            strokeWidth={2}
          />
        </button>
        <div className="h-px flex-1 bg-zGray-800" aria-hidden="true" />
      </div>
      <div className={clsx('t-turn-fold', open && 'is-open')} inert={!open} aria-hidden={!open}>
        <div>
          <div className="pt-2 space-y-2">{open ? children() : null}</div>
        </div>
      </div>
    </div>
  )
}

export function LoadingText({ children, className }: { children: string; className?: string }) {
  const { ref, text } = useTextSwap<HTMLSpanElement>(children)

  return (
    <span ref={ref} className={clsx('codex-shimmer-text t-text-swap', className)}>
      {text}
    </span>
  )
}

export function ElapsedSeconds({ seconds }: { seconds: number }) {
  const [animating, setAnimating] = useState(false)
  const previousSecondsRef = useRef(seconds)

  useEffect(() => {
    if (previousSecondsRef.current === seconds) return
    previousSecondsRef.current = seconds
    setAnimating(false)
    const frame = requestAnimationFrame(() => setAnimating(true))
    const timeout = window.setTimeout(() => setAnimating(false), 560)

    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
    }
  }, [seconds])

  const chars = String(seconds).split('')

  return (
    <span
      className={clsx('t-digit-group', animating && 'is-animating')}
      aria-label={`${String(seconds)}s`}
    >
      {chars.map((ch, i) => (
        <span
          key={`${String(i)}-${ch}`}
          className="t-digit"
          data-stagger={i === chars.length - 2 ? '1' : i === chars.length - 1 ? '2' : undefined}
          aria-hidden="true"
        >
          {ch}
        </span>
      ))}
      <span aria-hidden="true">s</span>
    </span>
  )
}

function toolElapsedSeconds(part: ToolPart, now: number): number | null {
  if (typeof part.startedAt !== 'number') return null
  // Waiting on the user's authorization isn't execution — no ticking timer
  // (and a denied call never ran, so there is nothing to time either).
  if (part.state === 'approval-requested') return null
  if (part.approval?.approved === false) return null
  if (typeof part.completedAt === 'number') {
    return Math.max(0, Math.floor((part.completedAt - part.startedAt) / 1000))
  }
  if (part.state === 'output-available' || part.state === 'output-error') {
    return null
  }
  const end = now

  return Math.max(0, Math.floor((end - part.startedAt) / 1000))
}

export function ToolElapsedBadge({ part, now }: { part: ToolPart; now: number }) {
  const seconds = toolElapsedSeconds(part, now)

  if (seconds === null) return null

  return (
    <span
      className="font-mono text-[11.5px] text-tertiary/80 tabular-nums flex-shrink-0"
      style={{ transform: 'translateY(0.5px)' }}
    >
      <ElapsedSeconds seconds={seconds} />
    </span>
  )
}

/** `plan_update` / `plan_get` are agent bookkeeping: a shimmer line while one
 *  is in flight so the turn does not look stalled, nothing once it lands. */
export function PlanBookkeepingPart({ part, now }: { part: ToolPart; now: number }) {
  if (part.state === 'output-available' || part.state === 'output-error') return null

  return (
    <div className="text-[12.5px] text-tertiary inline-flex max-w-full items-center gap-1.5">
      <LoadingText>
        {part.toolName === 'plan_update' ? 'Updating plan progress' : 'Reading plan'}
      </LoadingText>
      <ToolElapsedBadge part={part} now={now} />
    </div>
  )
}
