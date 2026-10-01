/**
 * The window a FinOps figure covers. `until` is null for ranges that run up to
 * "now" — a closed month gets an explicit upper bound so its total stops
 * changing once the month ends.
 */
export type FinopsRange = {
  key: string
  since: Date
  until: Date | null
}

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/

// How far back the month picker may reach. Older windows are still queryable
// by key; this only bounds what the UI offers and what a typo can request.
const MAX_MONTHS_BACK = 24

function utcMonthStart(at: Date, monthsBack = 0): Date {
  const start = new Date(at)

  start.setUTCDate(1)
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCMonth(start.getUTCMonth() - monthsBack)

  return start
}

function utcDayStart(at: Date, daysBack = 0): Date {
  const start = new Date(at)

  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() - daysBack)

  return start
}

/** `2026-08` → the window covering that whole UTC month. */
function monthRange(key: string, now: Date): FinopsRange | null {
  const match = MONTH_KEY.exec(key)

  if (!match) return null
  const since = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1))

  if (since > now || since < utcMonthStart(now, MAX_MONTHS_BACK)) return null
  const until = new Date(since)

  until.setUTCMonth(until.getUTCMonth() + 1)

  return { key, since, until }
}

/**
 * Resolve a range key from the query string. Returns null for anything
 * unrecognised so the route can answer 400 rather than silently charting a
 * different window than the caller asked for.
 */
export function resolveFinopsRange(
  key: string | undefined,
  now: Date = new Date(),
): FinopsRange | null {
  const value = (key ?? '').trim() || 'mtd'

  if (value === 'mtd') return { key: value, since: utcMonthStart(now), until: null }
  if (value === 'last-month') {
    return { key: value, since: utcMonthStart(now, 1), until: utcMonthStart(now) }
  }
  // Trailing windows include today, so 7d is today plus the previous six days.
  if (value === '7d') return { key: value, since: utcDayStart(now, 6), until: null }
  if (value === '30d') return { key: value, since: utcDayStart(now, 29), until: null }

  return monthRange(value, now)
}

/** The `createdAt` clause for a range, for use inside a `$match`. */
export function rangeFilter(range: FinopsRange): { $gte: Date; $lt?: Date } {
  return range.until ? { $gte: range.since, $lt: range.until } : { $gte: range.since }
}

/** The last `count` months as picker options, newest first. */
export function recentMonthKeys(now: Date = new Date(), count = 12): string[] {
  return Array.from({ length: Math.min(count, MAX_MONTHS_BACK) }, (_, i) => {
    const month = utcMonthStart(now, i)

    return `${String(month.getUTCFullYear())}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`
  })
}
