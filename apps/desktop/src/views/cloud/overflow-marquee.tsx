import clsx from 'clsx'
import { useLayoutEffect, useRef, useState } from 'react'

import type { CSSProperties } from 'react'

/** Scroll speed while the hidden part of the text slides into view. */
const PX_PER_SECOND = 40

/**
 * One truncated line that, only when it overflows, slides sideways to show its end while the
 * surrounding `group` is hovered or holds keyboard focus, then slides back. The animation lives in
 * index.css (`.connector-marquee`). With reduced motion the line wraps to two lines instead, which
 * also keeps the overflow measurement stable because the class never changes the layout.
 */
export function OverflowMarquee({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(0)

  useLayoutEffect(() => {
    const element = ref.current

    if (!element) return
    const measure = () => setOverflow(Math.max(0, element.scrollWidth - element.clientWidth))

    measure()
    const observer = new ResizeObserver(measure)

    observer.observe(element)

    return () => observer.disconnect()
  }, [text])

  // Two slides plus the pauses at each end, which take 30% of the animation.
  const seconds = Math.max(2.5, ((overflow / PX_PER_SECOND) * 2) / 0.7)
  const style =
    overflow > 0
      ? ({
          '--marquee-shift': `-${String(overflow)}px`,
          '--marquee-duration': `${seconds.toFixed(2)}s`,
        } as CSSProperties)
      : undefined

  return (
    <span
      ref={ref}
      style={style}
      className={clsx(
        'block truncate motion-reduce:line-clamp-2 motion-reduce:whitespace-normal',
        overflow > 0 && 'connector-marquee',
        className,
      )}
    >
      {text}
    </span>
  )
}
