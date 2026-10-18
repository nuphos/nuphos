import clsx from 'clsx'
import { useEffect, useState } from 'react'

// A piece of an agent message: plain text, or text with its own classes (e.g.
// the violet "workspace" or the bold workspace name).
type StreamSegment = string | { text: string; className?: string }

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
// a blinking caret trails the text until it finishes. Reduced motion shows the
// text at once but keeps the sequence pacing via onDone.
// NOTE: `onDone` is an effect dependency — pass a stable (useCallback) ref.
export function StreamText({
  segments,
  reduce,
  startDelay = 0,
  onDone,
}: {
  segments: StreamSegment[]
  reduce: boolean
  /** ms before the first word appears — the agent's "thinking" beat. */
  startDelay?: number
  /** Fires once, a beat after the last word lands. */
  onDone?: () => void
}) {
  const words = flattenStreamWords(segments)
  const total = words.length
  const [count, setCount] = useState(() => (reduce ? total : 0))
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

    if (reduce) {
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
  }, [total, reduce, startDelay, onDone])

  return (
    <div
      className={clsx('text-[15px] leading-relaxed text-main', !done && 'agent-streaming-response')}
    >
      {words.slice(0, count).map((t, i) => (
        <span
          key={i}
          className={t.cls}
          style={
            reduce
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
