const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS

/**
 * Local wall-clock time in `timeZone`, as milliseconds on a UTC clock: day and
 * hour arithmetic on it gives local days and hours, half-hour zones included.
 */
export function zoneClock(timeZone: string): (at: number) => number {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  })
  // Offsets only change on a quarter hour, so one lookup serves the whole quarter.
  const offsets = new Map<number, number>()
  const offsetAt = (base: number) => {
    const parts = format.formatToParts(base)
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === type)?.value)

    return (
      Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute')) - base
    )
  }

  return (at) => {
    const quarter = Math.floor(at / (15 * 60_000))
    let offset = offsets.get(quarter)

    if (offset === undefined) {
      offset = offsetAt(quarter * 15 * 60_000)
      offsets.set(quarter, offset)
    }

    return at + offset
  }
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })

    return true
  } catch {
    return false
  }
}

/** The local day number (days since 1970-01-01) and hour of a wall-clock time. */
export const localDay = (wall: number) => Math.floor(wall / DAY_MS)
export const localHour = (wall: number) => Math.floor((wall % DAY_MS) / HOUR_MS)

/**
 * Days in a row ending today, or yesterday when today has none yet, and the
 * longest run, both within the lookback, so the current run never outgrows
 * the best one.
 */
export function streaks(activeDays: Set<number>, today: number, lookbackDays: number) {
  let current = 0

  for (let d = activeDays.has(today) ? today : today - 1; activeDays.has(d); d--) {
    if (current === lookbackDays) break
    current++
  }
  let best = 0
  let run = 0

  for (let d = today - lookbackDays + 1; d <= today; d++) {
    run = activeDays.has(d) ? run + 1 : 0
    best = Math.max(best, run)
  }

  return { current, best, lookbackDays }
}

/** The most turns that overlap at one moment, and when that first happened. */
export function peakOverlap(turns: [number, number][]): { count: number; at: number } | null {
  const edges = turns.flatMap(([from, to]): [number, number][] => [
    [from, 1],
    [to, -1],
  ])

  // Ends before starts at the same instant: back to back is not at once.
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let running = 0
  let peak: { count: number; at: number } | null = null

  for (const [at, step] of edges) {
    running += step
    if (running > (peak?.count ?? 0)) peak = { count: running, at }
  }

  return peak
}
