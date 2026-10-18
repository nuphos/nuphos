import { parseCron, pad2, scheduleSummary, WEEKDAYS } from '../../../views/triggers/cron.ts'
import { utcTimeOfDayInZone } from '../../../views/triggers/cronTime.ts'

const EVERY_N_MINUTES = /^\*\/(\d{1,2}) \* \* \* \*$/

function dayLabel(days: number[]): string {
  const key = [...days].sort((a, b) => a - b).join()

  if (days.length === 7) return 'Every day'
  if (key === '1,2,3,4,5') return 'Weekdays'
  if (key === '0,6') return 'Weekends'

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

  if (expr === '* * * * *') return 'Every minute'
  if (minutes) return `Every ${minutes} minutes`
  const mode = parseCron(expr)

  if (mode.kind === 'every-n-hours') {
    const at = mode.minute === 0 ? '' : ` at :${pad2(mode.minute)}`

    return mode.n === 1 ? `Every hour${at}` : `Every ${String(mode.n)} hours${at}`
  }
  if (mode.kind !== 'at-time') return scheduleSummary({ triggerType: 'cron', cronExpression: expr })
  const { dayShift } = utcTimeOfDayInZone(mode.hour, mode.minute, timeZone, now)
  const localDays = mode.days.map((day) => (day + dayShift + 7) % 7)
  const utc = `${pad2(mode.hour)}:${pad2(mode.minute)} UTC`
  const local = localClock(mode.hour, mode.minute, timeZone, now)

  if (timeZone === 'UTC') return `${dayLabel(mode.days)} at ${utc}`

  return `${dayLabel(localDays)} at ${local} your time (${utc})`
}
