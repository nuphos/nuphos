import { utcTimeOfDayInZone, viewerTimeZone } from './cronTime.ts'

// ────────────────────── Cron preset model ──────────────────────
// Two friendly modes + a raw escape hatch. Both modes parse back from an
// existing cron expression on edit; anything we can't recognise falls through
// to 'custom' so power users keep their hand-written schedule intact.
export type CronMode =
  | { kind: 'every-n-hours'; n: number; minute: number }
  | { kind: 'at-time'; hour: number; minute: number; days: number[] }
  | { kind: 'custom'; expr: string }

export const EVERY_N_HOURS_OPTIONS = [1, 2, 3, 4, 6, 8, 12] as const
// 0 = Sunday in standard cron. We render Mon first because that matches how
// most users mentally group "the week" — but we store/serialise the cron field
// using the 0-Sun convention.
export const WEEKDAYS: { value: number; short: string }[] = [
  { value: 1, short: 'Mon' },
  { value: 2, short: 'Tue' },
  { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' },
  { value: 5, short: 'Fri' },
  { value: 6, short: 'Sat' },
  { value: 0, short: 'Sun' },
]

export function parseCron(expr: string): CronMode {
  const parts = expr.trim().split(/\s+/)

  if (parts.length !== 5) return { kind: 'custom', expr }
  const [min, hr, dom, mon, dow] = parts

  if (dom !== '*' || mon !== '*') return { kind: 'custom', expr }
  const minuteNum = /^\d+$/.test(min) ? Number(min) : null

  if (minuteNum === null || minuteNum < 0 || minuteNum > 59) {
    return { kind: 'custom', expr }
  }
  // Every-N-hours: `M */N * * *`, or `M * * * *` for hourly.
  if (dow === '*') {
    if (hr === '*') return { kind: 'every-n-hours', n: 1, minute: minuteNum }
    const m = /^\*\/(\d+)$/.exec(hr)

    if (m) {
      const n = Number(m[1])

      if (EVERY_N_HOURS_OPTIONS.includes(n as (typeof EVERY_N_HOURS_OPTIONS)[number])) {
        return { kind: 'every-n-hours', n, minute: minuteNum }
      }
    }
  }
  // At-time: `M H * * <days>` where H is a literal and days is parseable.
  if (/^\d+$/.test(hr)) {
    const hourNum = Number(hr)

    if (hourNum >= 0 && hourNum <= 23) {
      const days = parseDays(dow)

      if (days) return { kind: 'at-time', hour: hourNum, minute: minuteNum, days }
    }
  }

  return { kind: 'custom', expr }
}

export function parseDays(spec: string): number[] | null {
  if (spec === '*') return [0, 1, 2, 3, 4, 5, 6]
  const out = new Set<number>()

  for (const part of spec.split(',')) {
    const m = /^(\d)(?:-(\d))?$/.exec(part)

    if (!m) return null
    const start = Number(m[1])
    const end = m[2] ? Number(m[2]) : start

    if (start > end || start < 0 || end > 7) return null
    for (let i = start; i <= end; i++) out.add(i === 7 ? 0 : i)
  }

  return [...out].sort((a, b) => a - b)
}

export function buildCron(mode: CronMode): string {
  if (mode.kind === 'custom') return mode.expr.trim()
  if (mode.kind === 'every-n-hours') {
    return mode.n === 1
      ? `${String(mode.minute)} * * * *`
      : `${String(mode.minute)} */${String(mode.n)} * * *`
  }
  // at-time
  if (mode.days.length === 0) return ''
  if (mode.days.length === 7) return `${String(mode.minute)} ${String(mode.hour)} * * *`

  return `${String(mode.minute)} ${String(mode.hour)} * * ${compactDays(mode.days)}`
}

export function compactDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b)
  const parts: string[] = []
  let i = 0

  while (i < sorted.length) {
    let j = i

    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    parts.push(i === j ? String(sorted[i]) : `${String(sorted[i])}-${String(sorted[j])}`)
    i = j + 1
  }

  return parts.join(',')
}

export function pad2(n: number) {
  return n.toString().padStart(2, '0')
}

/**
 * What makes a trigger fire, in words.
 *
 * The detail page leads with this, where the raw expression the list rows carry
 * would be the wrong altitude. Reusing parseCron means anything the builder
 * above can round-trip is described the way the builder would put it, and
 * anything it can't falls back to the expression itself — a hand-written
 * schedule is better shown verbatim than guessed at.
 *
 * Schedules run in UTC; the viewer's equivalent (on the date of `now`) follows
 * in parentheses.
 */
export function scheduleSummary(
  trigger: {
    triggerType?: 'cron' | 'webhook'
    cronExpression?: string
  },
  timeZone: string = viewerTimeZone(),
  now: Date = new Date(),
): string {
  if (trigger.triggerType !== 'cron') return 'Runs when its webhook receives a request'
  const expression = trigger.cronExpression?.trim()

  if (!expression) return 'No schedule set'
  const mode = parseCron(expression)

  if (mode.kind === 'every-n-hours') {
    if (mode.n === 1) {
      const local = utcTimeOfDayInZone(0, mode.minute, timeZone, now).hm.slice(3)
      const localNote = local === pad2(mode.minute) ? '' : ` (minute ${local} your time)`

      return `Runs every hour at minute ${pad2(mode.minute)}${localNote}`
    }

    return `Runs every ${String(mode.n)} hours at minute ${pad2(mode.minute)}, from ${utcTimeWithLocal(0, mode.minute, timeZone, now)}`
  }
  if (mode.kind === 'at-time') {
    const utc = `${pad2(mode.hour)}:${pad2(mode.minute)}`
    const local = utcTimeOfDayInZone(mode.hour, mode.minute, timeZone, now)

    if (mode.days.length === 7) {
      return `Runs every day at ${utcTimeWithLocal(mode.hour, mode.minute, timeZone, now)}`
    }
    const days = weekdayList(mode.days)

    if (local.dayShift === 0) {
      return `Runs ${days} at ${utcTimeWithLocal(mode.hour, mode.minute, timeZone, now)}`
    }
    const localDays = weekdayList(mode.days.map((day) => (day + local.dayShift + 7) % 7))

    return `Runs ${days} at ${utc} UTC (${localDays} ${local.hm} your time)`
  }

  return `Runs on schedule ${expression} (UTC)`
}

function weekdayList(days: number[]): string {
  return WEEKDAYS.filter((day) => days.includes(day.value))
    .map((day) => day.short)
    .join(', ')
}

function utcTimeWithLocal(hour: number, minute: number, timeZone: string, now: Date): string {
  const utc = `${pad2(hour)}:${pad2(minute)} UTC`
  const local = utcTimeOfDayInZone(hour, minute, timeZone, now).hm

  return local === utc.slice(0, 5) ? utc : `${utc} (${local} your time)`
}

export function sameMode(a: CronMode, b: CronMode): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'every-n-hours' && b.kind === 'every-n-hours')
    return a.n === b.n && a.minute === b.minute
  if (a.kind === 'at-time' && b.kind === 'at-time') {
    // Compare days as sets — toggling weekday chips appends in click order
    // while parseCron returns sorted, so a positional check would falsely
    // claim "different" and trigger an unnecessary mode reset in CronBuilder.
    if (a.hour !== b.hour || a.minute !== b.minute) return false
    if (a.days.length !== b.days.length) return false
    const aSorted = [...a.days].sort((x, y) => x - y)
    const bSorted = [...b.days].sort((x, y) => x - y)

    return aSorted.every((d, i) => d === bSorted[i])
  }
  if (a.kind === 'custom' && b.kind === 'custom') return a.expr === b.expr

  return false
}
