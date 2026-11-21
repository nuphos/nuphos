const OFFSET_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/iu
const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/u

/** How far `timeZone` is ahead of UTC at this instant, in milliseconds. */
function zoneOffsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(at))
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )

  return wall - Math.floor(at / 1000) * 1000
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })

    return true
  } catch {
    return false
  }
}

/**
 * The instant a due time names: an ISO time with `Z` or an offset, or a wall-clock time read in
 * `timeZone`. Null when it names none, so a time without a zone is never guessed.
 */
export function parseDueAt(dueAt: string, timeZone?: string): Date | null {
  const text = dueAt.trim()

  if (OFFSET_SUFFIX.test(text)) {
    const at = new Date(text)

    return Number.isNaN(at.getTime()) ? null : at
  }
  const match = WALL_TIME.exec(text)

  if (!match || !timeZone || !isTimeZone(timeZone)) return null
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0))
  const wall = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!)
  const first = wall - zoneOffsetMs(wall, timeZone)
  // The offset can differ at the instant it produced (across a clock change), so read it again.
  const at = new Date(wall - zoneOffsetMs(first, timeZone))

  // Date.UTC rolls 02-30 over to March, and a skipped clock hour moves; read back, the wall time must match.
  const readBack = new Date(at.getTime() + zoneOffsetMs(at.getTime(), timeZone))
  const asked = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`

  return readBack.toISOString().slice(0, 16) === asked ? at : null
}

/** A due time as its owner reads it: `YYYY-MM-DD HH:mm (Europe/Stockholm)`. */
export function describeDueAt(at: Date, timeZone = 'UTC'): string {
  const formatted = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(at)

  return `${formatted} (${timeZone})`
}
