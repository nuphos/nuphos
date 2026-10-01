import { useEffect, useState } from 'react'

export const HOUR_HEIGHT = 48
export const GRID_HEIGHT = 24 * HOUR_HEIGHT
export const MINUTE_HEIGHT = HOUR_HEIGHT / 60

export function isWeekend(day: Date): boolean {
  const weekday = day.getDay()

  return weekday === 0 || weekday === 6
}

/**
 * The width a classic (non-overlay) scrollbar takes out of `ref`'s content
 * box, tracked live. Overlay scrollbars measure 0. Rows outside the scroll
 * container pad by this so both sides divide the same span. ResizeObserver
 * fires on observe, so the first measurement needs no synchronous setState.
 */
export function useScrollbarInset(ref: React.RefObject<HTMLElement | null>): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const el = ref.current

    if (!el) return
    const observer = new ResizeObserver(() => {
      setInset(el.offsetWidth - el.clientWidth)
    })

    observer.observe(el)

    return () => observer.disconnect()
  }, [ref])

  return inset
}

/** The current minute, ticking — drives the now line and today highlight. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)

    return () => clearInterval(timer)
  }, [])

  return now
}
