import cronParser from 'cron-parser'

import { locale, t } from '../../i18n/index.ts'

import { scheduleSummary } from './cron.ts'
import { viewerTimeZone, zoneLabel } from './cronTime.ts'

export type DisplaySchedule = {
  triggerType?: 'cron' | 'webhook'
  cronExpression?: string
  timeZone?: string
}

/** The actual local calendar date and offset at this instant, including DST. */
export function formatViewerRun(instant: Date, timeZone = viewerTimeZone()): string {
  return `${instant.toLocaleString(locale, { timeZone })} (${zoneLabel(timeZone, instant)})`
}

/** Bounded expansion uses the same cron-parser and source timezone as scheduling. */
export function upcomingScheduleTimes(trigger: DisplaySchedule, now: Date): Date[] {
  if (trigger.triggerType !== 'cron' || !trigger.cronExpression) return []
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
 * Lead with exact dates in the viewer's zone. A shifted UTC month-day or a DST
 * clock cannot be safely described as a fixed local recurrence, so never
 * manufacture one. Keep the unmodified source rule after these local dates.
 * No user timezone preference exists yet; callers can provide a viewing zone,
 * otherwise viewerTimeZone() follows the device's Intl setting.
 */
export function userScheduleSummary(
  trigger: DisplaySchedule,
  timeZone = viewerTimeZone(),
  now = new Date(),
): string {
  const rule = scheduleSummary(trigger, 'UTC', now)
  const runs = upcomingScheduleTimes(trigger, now)

  if (runs.length === 0) return rule

  return t('Scheduled times: {times}. Source rule: {rule}', {
    times: runs.map((run) => formatViewerRun(run, timeZone)).join('; '),
    rule,
  })
}
