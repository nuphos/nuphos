import { t } from '../../i18n/index.ts'

import { commonCronSummary } from './cronSummaryExtras.ts'

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
  { value: 1, short: t('Mon') },
  { value: 2, short: t('Tue') },
  { value: 3, short: t('Wed') },
  { value: 4, short: t('Thu') },
  { value: 5, short: t('Fri') },
  { value: 6, short: t('Sat') },
  { value: 0, short: t('Sun') },
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

/** Describe the stored rule in its own timezone, without shifting calendar dates. */
export function scheduleSummary(
  trigger: { triggerType?: 'cron' | 'webhook'; cronExpression?: string; timeZone?: string },
  _viewerZone?: string,
  _now?: Date,
): string {
  if (trigger.triggerType !== 'cron') return t('Runs when its webhook receives a request')
  const expression = trigger.cronExpression?.trim()

  if (!expression) return t('No schedule set')
  const zone = trigger.timeZone || 'UTC'
  const clock = (hour: number, minute: number) => `${pad2(hour)}:${pad2(minute)} ${zone}`
  const extra = commonCronSummary(expression, clock, zone)

  if (extra) return extra
  const mode = parseCron(expression)

  if (mode.kind === 'every-n-hours') {
    if (mode.n === 1)
      return t('Runs every hour at minute {minute} ({zone})', { minute: pad2(mode.minute), zone })

    return t('Runs every {n} hours at minute {minute}, from {time}', {
      n: mode.n,
      minute: pad2(mode.minute),
      time: clock(0, mode.minute),
    })
  }
  if (mode.kind === 'at-time') {
    const time = clock(mode.hour, mode.minute)

    if (mode.days.length === 7) return t('Runs every day at {time}', { time })

    return t('Runs {days} at {time}', {
      days: WEEKDAYS.filter((day) => mode.days.includes(day.value))
        .map((day) => day.short)
        .join(', '),
      time,
    })
  }

  return t('Runs on schedule {expression} ({zone})', { expression, zone })
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
