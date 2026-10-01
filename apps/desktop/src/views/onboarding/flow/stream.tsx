import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'

import type { ReactNode } from 'react'

// A piece of an agent message: plain text, or text with its own classes (e.g.
// the violet "workspace" or the bold workspace name).
export type StreamSegment = string | { text: string; className?: string }

// ms between words while an agent message "types" itself out.
const STREAM_WORD_TICK = 55

function flattenStreamWords(segments: StreamSegment[]): { w: string; cls?: string }[] {
  const out: { w: string; cls?: string }[] = []

  for (const seg of segments) {
    const text = typeof seg === 'string' ? seg : seg.text
    const cls = typeof seg === 'string' ? undefined : seg.className

    for (const w of text.split(/(?<=\s)/)) {
      if (w) out.push({ w, cls })
    }
  }

  return out
}

// Assistant message that streams in word by word, like the real agent typing —
// each word enters with the shared Streamdown motion (sd-atlas-stream-in) and
// a blinking caret trails the text until it finishes. `skip` renders the full
// text statically (history on dev jumps shouldn't re-type itself); reduced
// motion shows the text at once but keeps the sequence pacing via onDone.
// NOTE: `onDone` is an effect dependency — pass a stable (useCallback) ref.
export function StreamText({
  segments,
  reduce,
  skip = false,
  startDelay = 0,
  onDone,
}: {
  segments: StreamSegment[]
  reduce: boolean
  skip?: boolean
  /** ms before the first word appears — the agent's "thinking" beat. */
  startDelay?: number
  /** Fires once, a beat after the last word lands (immediately when skipped). */
  onDone?: () => void
}) {
  const words = flattenStreamWords(segments)
  const total = words.length
  const [count, setCount] = useState(() => (skip || reduce ? total : 0))
  const done = count >= total

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

    if (skip) {
      at(0, () => {
        setCount(total)
        onDone?.()
      })
    } else if (reduce) {
      at(0, () => setCount(total))
      at(350, () => onDone?.())
    } else {
      for (let i = 1; i <= total; i++) {
        at(startDelay + i * STREAM_WORD_TICK, () => setCount(i))
      }
      at(startDelay + total * STREAM_WORD_TICK + 320, () => onDone?.())
    }

    return () => {
      cancelled = true
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [total, skip, reduce, startDelay, onDone])

  return (
    <div
      className={clsx('text-[15px] leading-relaxed text-main', !done && 'agent-streaming-response')}
    >
      {words.slice(0, count).map((t, i) => (
        <span
          key={i}
          className={t.cls}
          style={
            skip || reduce
              ? undefined
              : { animation: 'sd-atlas-stream-in 240ms cubic-bezier(0.16, 1, 0.3, 1) both' }
          }
        >
          {t.w}
        </span>
      ))}
    </div>
  )
}

// Keeps a growing block in view while it writes itself. The onboarding
// transcript deliberately never scrolls on the user's behalf — they read from
// the top and move at their own pace — but the stretch after an approval is
// the agent talking, unprompted, past the bottom of the panel. Following it
// there is the difference between watching a reply and missing one. Stops the
// moment the block stops growing (`active` false), handing the scroller back.
export function FollowGrowth({
  reduce,
  active,
  children,
}: {
  reduce: boolean
  active: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = ref.current

    if (!node || !active) return
    const scroller = node.closest('[data-transcript-scroll]')

    if (!scroller) return
    const follow = () => {
      const target = scroller.scrollHeight - scroller.clientHeight

      if (target - scroller.scrollTop <= 0) return
      scroller.scrollTo({ top: target, behavior: reduce ? 'auto' : 'smooth' })
    }

    follow()
    const ro = new ResizeObserver(follow)

    ro.observe(node)

    return () => ro.disconnect()
  }, [active, reduce])

  return (
    <div ref={ref} className="space-y-3">
      {children}
    </div>
  )
}
