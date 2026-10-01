// Cron schedules are stored and evaluated in UTC. These helpers put a UTC
// instant next to the viewer's wall clock; every function takes the zone
// explicitly so callers (and tests) decide whose clock "your time" means.

export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

type ZonedParts = { weekday: string; ymd: string; hm: string }

const partsFormatters = new Map<string, Intl.DateTimeFormat>()

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  let formatter = partsFormatters.get(timeZone)

  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    partsFormatters.set(timeZone, formatter)
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    formatter.formatToParts(instant).find((p) => p.type === type)?.value ?? ''

  return {
    weekday: part('weekday'),
    ymd: `${part('year')}-${part('month')}-${part('day')}`,
    hm: `${part('hour')}:${part('minute')}`,
  }
}

/** "UTC+8", "UTC+5:30", "UTC-7", or "UTC" for a zero offset. */
export function utcOffsetLabel(instant: Date, timeZone: string): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(instant)
    .find((p) => p.type === 'timeZoneName')?.value

  // ICU builds disagree on zero: some print "GMT", others "GMT+0".
  return (name ?? 'GMT').replace(/^GMT/, 'UTC').replace(/^UTC[+-]0(?::00)?$/, 'UTC')
}

/** "Asia/Taipei, UTC+8" — the zone the calendar grid is drawn in. */
export function zoneLabel(timeZone: string, instant: Date): string {
  const offset = utcOffsetLabel(instant, timeZone)

  return timeZone === 'UTC' ? offset : `${timeZone}, ${offset}`
}

/**
 * "09:00 UTC (17:00 your time)". When the two clocks fall on different dates
 * both sides carry their weekday: "Sun 23:00 UTC (Mon 07:00 your time)".
 * A viewer on UTC just gets "09:00 UTC".
 */
export function formatUtcAndLocal(instant: Date, timeZone: string): string {
  const utc = zonedParts(instant, 'UTC')
  const local = zonedParts(instant, timeZone)

  if (utc.ymd === local.ymd && utc.hm === local.hm) return `${utc.hm} UTC`
  if (utc.ymd === local.ymd) return `${utc.hm} UTC (${local.hm} your time)`

  return `${utc.weekday} ${utc.hm} UTC (${local.weekday} ${local.hm} your time)`
}

const UTC_RUN_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})

/** A run in a list: "Mon, Sep 28 · 09:00 UTC (17:00 your time)", dated in UTC. */
export function formatUtcRun(instant: Date, timeZone: string): string {
  return `${UTC_RUN_DATE.format(instant)} · ${formatUtcAndLocal(instant, timeZone)}`
}

/**
 * Where a UTC time of day lands on the viewer's clock, on the date of `ref`.
 * `dayShift` is -1 / 0 / +1 when the local date is before / on / after the
 * UTC date — what turns "Mon 01:00 UTC" into "Sun 18:00" in Los Angeles.
 */
export function utcTimeOfDayInZone(
  hour: number,
  minute: number,
  timeZone: string,
  ref: Date,
): { hm: string; dayShift: -1 | 0 | 1 } {
  const instant = new Date(
    Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), hour, minute),
  )
  const utc = zonedParts(instant, 'UTC')
  const local = zonedParts(instant, timeZone)

  if (local.ymd === utc.ymd) return { hm: local.hm, dayShift: 0 }

  return { hm: local.hm, dayShift: local.ymd < utc.ymd ? -1 : 1 }
}
