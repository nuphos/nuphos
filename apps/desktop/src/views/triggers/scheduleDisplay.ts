import { locale, t } from '../../i18n/index.ts'

import { nextOccurrencesAfter } from './calendar/occurrences.ts'
import { scheduleSummary } from './cron.ts'
import { utcOffsetLabel, viewerTimeZone, zoneLabel } from './cronTime.ts'

export type DisplaySchedule = {
  triggerType?: 'cron' | 'webhook'
  cronExpression?: string
  timeZone?: string
  /** Undefined denotes an unsaved schedule preview, not a paused trigger. */
  enabled?: boolean
}

/** The actual local calendar date and offset at this instant, including DST. */
export function formatViewerRun(
  instant: Date,
  timeZone = viewerTimeZone(),
  includeZone = true,
): string {
  return `${instant.toLocaleString(locale, { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${includeZone ? zoneLabel(timeZone, instant) : utcOffsetLabel(instant, timeZone)})`
}

/**
 * Lead with the next exact date in the viewer's zone. A shifted UTC month-day or a DST
 * clock cannot be safely described as a fixed local recurrence, so never
 * manufacture one. More occurrences and the source rule live in the details.
 * No user timezone preference exists yet; callers can provide a viewing zone,
 * otherwise viewerTimeZone() follows the device's Intl setting.
 */
export function userScheduleSummary(
  trigger: DisplaySchedule,
  timeZone = viewerTimeZone(),
  now = new Date(),
): string {
  const rule = scheduleSummary(trigger, 'UTC', now)

  if (trigger.enabled === false) return `${t('Paused')} · ${rule}`
  if (trigger.triggerType !== 'cron' || !trigger.cronExpression) return rule
  const runs = nextOccurrencesAfter(trigger.cronExpression, now, 1, trigger.timeZone || 'UTC')

  if (runs.length === 0) return rule

  const next = t('Scheduled: {time}', { time: formatViewerRun(runs[0], timeZone) })
  const expression = trigger.cronExpression.trim()
  const [minute, hour] = expression.split(/\s+/)

  // Keep sub-daily rules visible on touch screens too. Do not derive a local
  // recurrence from offsets; the source rule and next exact instant stay separate.
  if (expression === '* * * * *') return `${t('Every minute')} · ${next}`
  const step = /^\*\/(\d+) \* \* \* \*$/.exec(expression)
  const n = Number(step?.[1])

  if (n > 0 && n < 60 && 60 % n === 0) return `${t('Every {n} minutes', { n })} · ${next}`
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return `${rule} · ${next}`

  return next
}

export function sourceScheduleRule(trigger: DisplaySchedule): string {
  return t('Source rule: {rule}', { rule: scheduleSummary(trigger, 'UTC') })
}
