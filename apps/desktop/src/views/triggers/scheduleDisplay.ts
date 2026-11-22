import cronParser from 'cron-parser'

import { locale, t } from '../../i18n/index.ts'

import { scheduleSummary } from './cron.ts'
import { viewerTimeZone, zoneLabel } from './cronTime.ts'

export type DisplaySchedule = {
  triggerType?: 'cron' | 'webhook'
  cronExpression?: string
  timeZone?: string
  /** Undefined denotes an unsaved schedule preview, not a paused trigger. */
  enabled?: boolean
}

/** The actual local calendar date and offset at this instant, including DST. */
export function formatViewerRun(instant: Date, timeZone = viewerTimeZone()): string {
  return `${instant.toLocaleString(locale, { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${zoneLabel(timeZone, instant)})`
}

/** Bounded expansion uses the same cron-parser and source timezone as scheduling. */
export function upcomingScheduleTimes(trigger: DisplaySchedule, now: Date): Date[] {
  if (trigger.enabled === false || trigger.triggerType !== 'cron' || !trigger.cronExpression)
    return []
  try {
    const interval = cronParser.parseExpression(trigger.cronExpression, {
      currentDate: now,
      tz: trigger.timeZone || 'UTC',
    })

    return Array.from({ length: 3 }, () => interval.next().toDate())
  } catch {
    return []
  }
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
  const runs = upcomingScheduleTimes(trigger, now)

  if (runs.length === 0) return rule

  return t('Scheduled: {time}', { time: formatViewerRun(runs[0], timeZone) })
}

export function sourceScheduleRule(trigger: DisplaySchedule): string {
  return t('Source rule: {rule}', { rule: scheduleSummary(trigger, 'UTC') })
}
