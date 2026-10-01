import clsx from 'clsx'
import { Check, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

// The steps of a single agent task, ticked off one at a time — the Action
// claim playing rather than described. All six rows stay mounted throughout
// (opacity only, never unmounted) so the card never changes height mid-loop.
// Decorative (aria-hidden); the heading + body above carry the message.
const ACTION_STEPS = [
  'investigate latency spike',
  'inspect resources',
  'read logs',
  'generate plan',
  'request approval',
  'apply change',
]

export function ActionDemo({
  reduce,
  startDelay = 0,
  onFirstPass,
}: {
  reduce: boolean
  /** ms before the first loop starts — lets the reveal cascade land first. */
  startDelay?: number
  /** Fires once, when the first full cycle finishes — the loop keeps going
   *  afterwards for anyone who lingers. NOTE: an effect dependency here, same
   *  as StreamText's `onDone` — pass a stable (useCallback) ref. */
  onFirstPass: () => void
}) {
  // -1 nothing started · 0..ACTION_STEPS.length-1 that step is running ·
  // ACTION_STEPS.length everything is done. Reduced motion pins the finished
  // state, no loop.
  const [progress, setProgress] = useState(reduce ? ACTION_STEPS.length : -1)
  // One-shot guard for onFirstPass — the loop keeps running (and re-hits the
  // "everything done" tick) forever, but the reply it unlocks should only be
  // signaled once.
  const firstPassFiredRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    const timers: number[] = []
    const at = (delay: number, fn: () => void) => {
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) fn()
        }, delay),
      )
    }
    const signalFirstPass = () => {
      if (firstPassFiredRef.current) return
      firstPassFiredRef.current = true
      onFirstPass()
    }

    if (reduce) {
      at(0, () => {
        setProgress(ACTION_STEPS.length)
        signalFirstPass()
      })
    } else {
      const run = () => {
        setProgress(-1)
        let cumulative = 0
        const tick = (delay: number, fn: () => void) => {
          cumulative += delay
          at(cumulative, fn)
        }

        ACTION_STEPS.forEach((_, i) => tick(i === 0 ? 500 : 420, () => setProgress(i)))
        tick(420, () => {
          setProgress(ACTION_STEPS.length)
          signalFirstPass()
        })
        tick(1600, run)
      }

      at(startDelay, run)
    }

    return () => {
      cancelled = true
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [reduce, startDelay, onFirstPass])

  return (
    <div
      aria-hidden
      className="space-y-1.5 rounded-xl border border-zGray-800/70 bg-zGray-950/40 px-3.5 py-3"
    >
      <div className="flex items-center gap-1.5 pb-0.5 font-mono text-[10.5px] text-tertiary">
        <span>agent</span>
        <span>·</span>
        <span>task</span>
      </div>
      {ACTION_STEPS.map((label, i) => {
        const state =
          progress >= ACTION_STEPS.length || i < progress
            ? 'done'
            : i === progress
              ? 'running'
              : 'pending'

        return (
          <div
            key={label}
            className={clsx(
              'flex items-center gap-2 text-[12px] transition-opacity duration-300',
              state === 'pending' ? 'opacity-0' : 'opacity-100',
            )}
          >
            {state === 'running' ? (
              <Loader2
                className="h-3 w-3 flex-shrink-0 animate-spin text-tertiary"
                strokeWidth={2}
              />
            ) : (
              <Check className="h-3 w-3 flex-shrink-0 text-emerald-400" strokeWidth={2.4} />
            )}
            {state === 'running' ? (
              <span className="codex-shimmer-text t-text-swap truncate">{label}</span>
            ) : (
              <span className="truncate text-secondary">{label}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Facts the agent has learned about this account, accumulating one chip at a
// time while the counter ticks up to match — the Memory claim playing rather
// than described. Decorative (aria-hidden); the heading + body carry the
// message.
const MEMORY_FACTS = [
  'api-server',
  'postgres',
  'prod',
  'deploy flow',
  'incident #412',
  'runbook',
  'staging',
]

export function MemoryDemo({
  reduce,
  startDelay = 0,
  onFirstPass,
}: {
  reduce: boolean
  /** ms before the first loop starts — lets the reveal cascade land first. */
  startDelay?: number
  /** Fires once, when the first full cycle finishes — the loop keeps going
   *  afterwards for anyone who lingers. NOTE: an effect dependency here, same
   *  as StreamText's `onDone` — pass a stable (useCallback) ref. */
  onFirstPass: () => void
}) {
  const total = MEMORY_FACTS.length
  const [count, setCount] = useState(reduce ? total : 0)
  // One-shot guard for onFirstPass — see ActionDemo.
  const firstPassFiredRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    const timers: number[] = []
    const at = (delay: number, fn: () => void) => {
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) fn()
        }, delay),
      )
    }
    const signalFirstPass = () => {
      if (firstPassFiredRef.current) return
      firstPassFiredRef.current = true
      onFirstPass()
    }

    if (reduce) {
      at(0, () => {
        setCount(total)
        signalFirstPass()
      })
    } else {
      const run = () => {
        setCount(0)
        let cumulative = 0
        const tick = (delay: number, fn: () => void) => {
          cumulative += delay
          at(cumulative, fn)
        }

        for (let i = 1; i <= total; i++) {
          tick(i === 1 ? 550 : 380, () => {
            setCount(i)
            if (i === total) signalFirstPass()
          })
        }
        tick(1800, run)
      }

      at(startDelay, run)
    }

    return () => {
      cancelled = true
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [reduce, startDelay, total, onFirstPass])

  return (
    <div
      aria-hidden
      className="space-y-2.5 rounded-xl border border-zGray-800/70 bg-zGray-950/40 px-3.5 py-3"
    >
      <div className="flex items-center gap-2 text-[12.5px]">
        <span className="text-secondary">facts learned</span>
        <span
          key={count}
          className="t-digit-group is-animating ml-auto font-mono text-[13px] text-zViolet-300"
        >
          <span className="t-digit">{count}</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {MEMORY_FACTS.map((fact, i) => (
          <span
            key={fact}
            className={clsx(
              'rounded border border-zGray-800 px-1.5 py-0.5 font-mono text-[10.5px] text-tertiary transition-opacity duration-300',
              i < count ? 'opacity-100' : 'opacity-0',
            )}
          >
            {fact}
          </span>
        ))}
      </div>
    </div>
  )
}
