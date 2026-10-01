import clsx from 'clsx'
import { BookOpen, Globe, LayoutDashboard, LayoutGrid, Terminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { ShieldCheck } from 'lucide-react'

// The four tools an engineer used to juggle, taking turns in the spotlight —
// then dimming as Nuphos's own workspace lights up in their place. The
// Experience claim playing rather than described. Decorative (aria-hidden);
// the heading + body carry the message.
const EXPERIENCE_TOOLS: { key: string; label: string; icon: typeof ShieldCheck }[] = [
  { key: 'terminal', label: 'terminal', icon: Terminal },
  { key: 'console', label: 'console', icon: Globe },
  { key: 'dashboard', label: 'dashboard', icon: LayoutDashboard },
  { key: 'docs', label: 'docs', icon: BookOpen },
]

export function ExperienceDemo({
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
  // 0-3: that tool is lit · EXPERIENCE_TOOLS.length: everything dims and the
  // unified workspace lights instead. Reduced motion pins the unified state,
  // no loop.
  const [lit, setLit] = useState(reduce ? EXPERIENCE_TOOLS.length : 0)
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
        setLit(EXPERIENCE_TOOLS.length)
        signalFirstPass()
      })
    } else {
      const run = () => {
        setLit(0)
        let cumulative = 0
        const tick = (delay: number, fn: () => void) => {
          cumulative += delay
          at(cumulative, fn)
        }

        for (let i = 1; i < EXPERIENCE_TOOLS.length; i++) {
          tick(480, () => setLit(i))
        }
        tick(480, () => {
          setLit(EXPERIENCE_TOOLS.length)
          signalFirstPass()
        })
        tick(1900, run)
      }

      at(startDelay, run)
    }

    return () => {
      cancelled = true
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [reduce, startDelay, onFirstPass])

  const unified = lit === EXPERIENCE_TOOLS.length

  return (
    <div
      aria-hidden
      className="space-y-2 rounded-xl border border-zGray-800/70 bg-zGray-950/40 px-3.5 py-3"
    >
      <div className="grid grid-cols-4 gap-1.5">
        {EXPERIENCE_TOOLS.map(({ key, label, icon: Icon }, i) => {
          const active = !unified && lit === i

          return (
            <div
              key={key}
              className={clsx(
                'flex flex-col items-center gap-1 rounded-lg border px-1.5 py-2 transition-colors duration-300',
                active
                  ? 'border-zViolet-500/60 bg-zViolet-500/10'
                  : 'border-zGray-800/70 bg-zGray-900/40',
              )}
            >
              <Icon
                className={clsx('h-3.5 w-3.5', active ? 'text-zViolet-300' : 'text-tertiary')}
                strokeWidth={1.8}
              />
              <span className={clsx('text-[9.5px]', active ? 'text-secondary' : 'text-tertiary')}>
                {label}
              </span>
            </div>
          )
        })}
      </div>
      <div
        className={clsx(
          'flex items-center gap-2 rounded-lg border px-3 py-2 transition-all duration-500',
          unified
            ? 'border-zViolet-500/60 bg-zViolet-500/10 opacity-100'
            : 'border-zGray-800/70 bg-zGray-900/20 opacity-40',
        )}
      >
        <LayoutGrid
          className={clsx(
            'h-3.5 w-3.5 flex-shrink-0',
            unified ? 'text-zViolet-300' : 'text-tertiary',
          )}
          strokeWidth={1.8}
        />
        <span className={clsx('text-[11.5px]', unified ? 'text-main' : 'text-tertiary')}>
          nuphos workspace
        </span>
        <span
          className={clsx(
            'ml-auto flex items-center gap-1 transition-opacity duration-300',
            unified ? 'opacity-100' : 'opacity-0',
          )}
        >
          <span className="rounded border border-zGray-800 px-1.5 py-0.5 font-mono text-[10.5px] text-tertiary">
            engineer
          </span>
          <span className="rounded border border-zGray-800 px-1.5 py-0.5 font-mono text-[10.5px] text-tertiary">
            agent
          </span>
        </span>
      </div>
    </div>
  )
}
