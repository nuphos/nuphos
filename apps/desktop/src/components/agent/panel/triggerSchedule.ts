import { t } from '../../../i18n/index.ts'
import { parseCron, pad2, scheduleSummary, WEEKDAYS } from '../../../views/triggers/cron.ts'
import { utcOffsetLabel, utcTimeOfDayInZone } from '../../../views/triggers/cronTime.ts'

const EVERY_N_MINUTES = /^\*\/(\d{1,2}) \* \* \* \*$/

function dayLabel(days: number[]): string {
  const key = [...days].sort((a, b) => a - b).join()

  if (days.length === 7) return t('Every day')
  if (key === '1,2,3,4,5') return t('Weekdays')
  if (key === '0,6') return t('Weekends')

  return WEEKDAYS.filter((day) => days.includes(day.value))
    .map((day) => day.short)
    .join(', ')
}

function localClock(hour: number, minute: number, timeZone: string, now: Date): string {
  const instant = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute),
  )

  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(
    instant,
  )
}

/** A cron schedule as the card says it: your time first, UTC after, e.g. "Weekdays at 9:00 AM your time (16:00 UTC)". */
export function cardSchedule(expression: string, timeZone: string, now: Date = new Date()): string {
  const expr = expression.trim()
  const minutes = EVERY_N_MINUTES.exec(expr)?.[1]

  if (expr === '* * * * *') return t('Every minute')
  if (minutes) return t('Every {n} minutes', { n: minutes })
  const mode = parseCron(expr)

  if (mode.kind === 'every-n-hours') {
    const n = String(mode.n)
    const minute = pad2(mode.minute)

    if (mode.minute === 0) return mode.n === 1 ? t('Every hour') : t('Every {n} hours', { n })

    return mode.n === 1
      ? t('Every hour at :{minute}', { minute })
      : t('Every {n} hours at :{minute}', { n, minute })
  }
  if (mode.kind !== 'at-time') return scheduleSummary({ triggerType: 'cron', cronExpression: expr })
  const { dayShift } = utcTimeOfDayInZone(mode.hour, mode.minute, timeZone, now)
  const localDays = mode.days.map((day) => (day + dayShift + 7) % 7)
  const utc = `${pad2(mode.hour)}:${pad2(mode.minute)} UTC`
  const local = localClock(mode.hour, mode.minute, timeZone, now)

  if (timeZone === 'UTC') return t('{days} at {time}', { days: dayLabel(mode.days), time: utc })

  return t('{days} at {time} your time ({utc})', { days: dayLabel(localDays), time: local, utc })
}

/**
 * A trigger's schedule in a few words. A rule kept in a zone other than UTC already counts its
 * hours there, so its clock is shown as written with that zone's offset: "Mon at 09:00 UTC+8".
 */
export function triggerSchedule(
  trigger: { triggerType?: 'cron' | 'webhook'; cronExpression?: string; timeZone?: string },
  viewerZone: string,
  now: Date = new Date(),
): string {
  if (trigger.triggerType !== 'cron') return scheduleSummary(trigger)
  const zone = trigger.timeZone
  const expression = trigger.cronExpression ?? ''

  if (!zone || zone === 'UTC') return cardSchedule(expression, viewerZone, now)
  const mode = parseCron(expression)

  if (mode.kind === 'at-time')
    return t('{days} at {time}', {
      days: dayLabel(mode.days),
      time: `${pad2(mode.hour)}:${pad2(mode.minute)} ${utcOffsetLabel(now, zone)}`,
    })
  // Every N minutes or hours reads the same in any zone.
  if (
    mode.kind === 'every-n-hours' ||
    EVERY_N_MINUTES.test(expression.trim()) ||
    expression.trim() === '* * * * *'
  )
    return cardSchedule(expression, viewerZone, now)

  return scheduleSummary(trigger)
}
