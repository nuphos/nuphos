import { faCheck, faCopy } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import clsx from 'clsx'
import { useState } from 'react'

import { toast } from '../../../components/ui/toast'

import type { Stage } from './progress'

// The scenario's two steps, compressed to one row. Shown wherever the
// user is deep in micro-steps, so "2 of 5" reads as progress inside the first
// big step rather than the whole journey — finishing the checklist should
// feel like step one done, not "five steps done and now there's more".
export function JourneyMini({
  phase,
  progress,
}: {
  /** `done` is the journey's end state: both filled, nothing active. */
  phase: 'connect' | 'ask' | 'done'
  /** Micro-progress inside the active step, drawn as a ring around its
   *  marker — the big step visibly fills up as its small moves complete. */
  progress?: { value: number; max: number }
}) {
  const steps = [
    { label: 'Connect', short: 'Connect' },
    { label: 'Ask', short: 'Ask' },
  ]
  const activeIndex = phase === 'connect' ? 0 : phase === 'ask' ? 1 : steps.length

  return (
    // Equal halves, stepper-style: every step owns the same width and its
    // connector fills whatever its label leaves over, so the two markers
    // land at even intervals no matter how long the labels run.
    <div className="grid grid-cols-2 items-center gap-x-1.5">
      {steps.map((s, i) => {
        const state = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending'

        return (
          <div key={s.short} className="flex min-w-0 items-center gap-1.5">
            <span
              className={clsx(
                'relative flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full text-[10px] font-medium',
                // Done keeps its number and fills solid instead of switching
                // to a green check — the marker doesn't change identity on
                // completion, it just fills in.
                state === 'done' && 'bg-zViolet-500 text-white',
                // Hollow: the ring around it carries the fill, so the marker
                // itself stays open until the step is truly done.
                state === 'active' &&
                  (progress
                    ? 'text-zViolet-accent'
                    : 'border border-zViolet-500/60 text-zViolet-accent'),
                state === 'pending' && 'border border-zGray-800 text-tertiary',
              )}
              role={state === 'active' && progress ? 'progressbar' : undefined}
              aria-valuemin={state === 'active' && progress ? 0 : undefined}
              aria-valuemax={state === 'active' && progress ? progress.max : undefined}
              aria-valuenow={state === 'active' && progress ? progress.value : undefined}
              aria-label={
                state === 'active' && progress
                  ? `${s.label} — step ${String(progress.value)} of ${String(progress.max)}`
                  : undefined
              }
            >
              {i + 1}
              {state === 'active' && progress && (
                <ProgressRing fraction={progress.value / progress.max} />
              )}
            </span>
            <span
              className={clsx(
                'truncate text-[11px]',
                state === 'active'
                  ? 'font-medium text-main'
                  : state === 'done'
                    ? 'text-secondary'
                    : 'text-tertiary',
              )}
            >
              {state === 'active' ? s.label : s.short}
            </span>
            {i < steps.length - 1 && <div className="h-px min-w-2 flex-1 bg-zGray-800" />}
          </div>
        )
      })}
    </div>
  )
}

// The ring around an active journey marker: micro-progress as a filling
// circle, so the big step visibly closes toward done instead of quoting
// numbers at the user.
// Drawn inside the marker's own 18px footprint — the ring IS this circle's
// border, so the active marker stays exactly the size of its siblings.
const RING_RADIUS = 7.5
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function ProgressRing({ fraction }: { fraction: number }) {
  const clamped = Math.min(1, Math.max(0, fraction))

  return (
    <svg
      className="absolute inset-0 h-[18px] w-[18px] -rotate-90"
      viewBox="0 0 18 18"
      aria-hidden="true"
    >
      <circle
        cx="9"
        cy="9"
        r={RING_RADIUS}
        fill="none"
        strokeWidth="2.5"
        className="stroke-zGray-800"
      />
      <circle
        cx="9"
        cy="9"
        r={RING_RADIUS}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={RING_CIRCUMFERENCE * (1 - clamped)}
        className="stroke-zViolet-accent transition-[stroke-dashoffset] duration-300 ease-out"
      />
    </svg>
  )
}

// Icon-only copy affordance for the seeded question. CopyableValue renders the
// value (or a label) as a mono chip, which reads as one more thing to parse
// next to a paragraph this long — here the full text already sits above, so
// the affordance shrinks to the corner.
export function CopyQuestionButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy', 'Clipboard was blocked.')
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title="Copy"
      aria-label="Copy the question"
      className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-zGray-800/60 hover:text-main"
    >
      <FontAwesomeIcon
        icon={copied ? faCheck : faCopy}
        className={clsx('h-3 w-3', copied && 'text-zViolet-accent')}
      />
    </button>
  )
}

export function JourneyStrip({
  stage,
  setupStep,
  setupTotal,
}: {
  stage: Stage
  setupStep: number
  setupTotal: number
}) {
  return (
    <>
      {/* Pinned above the scroll area: the journey strip is the progress
            indicator, and progress that scrolls out of view stops indicating.
            The long setup steps scroll under it. */}
      {stage.kind === 'setup' && stage.purpose === 'operational' && (
        <div className="flex-shrink-0 border-b border-zGray-800/60 px-3 pb-2.5 pt-2">
          <JourneyMini phase="connect" progress={{ value: setupStep + 1, max: setupTotal }} />
        </div>
      )}
      {stage.kind === 'connected' && (
        <div className="flex-shrink-0 border-b border-zGray-800/60 px-3 pb-2.5 pt-2">
          {/* Ask's three micro-moves all live on the next screen; the empty
                ring says "started, nothing done yet". */}
          <JourneyMini phase="ask" progress={{ value: 0, max: 3 }} />
        </div>
      )}
      {stage.kind === 'first-question' && (
        <div className="flex-shrink-0 border-b border-zGray-800/60 px-3 pb-2.5 pt-2">
          {/* One tick per conversation move: on the page, question sent,
                answer in. */}
          <JourneyMini
            phase="ask"
            progress={{
              value: 1 + (stage.asked ? 1 : 0) + (stage.answered ? 1 : 0),
              max: 3,
            }}
          />
        </div>
      )}
      {stage.kind === 'finished' && (
        <div className="flex-shrink-0 border-b border-zGray-800/60 px-3 pb-2.5 pt-2">
          <JourneyMini phase="done" />
        </div>
      )}
    </>
  )
}
