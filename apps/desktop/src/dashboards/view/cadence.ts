import { locale, t } from '../../i18n/index.ts'
import type { DashboardCadence } from '../schema.ts'

export const CADENCE_LABELS: Record<DashboardCadence, string> = {
  daily: t('Daily'),
  weekly: t('Weekly'),
  monthly: t('Monthly'),
}

const RUN_HOUR_UTC = 9

export function nextCadenceRun(cadence: DashboardCadence, now: Date): Date {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const d = now.getUTCDate()

  if (cadence === 'monthly') {
    const run = new Date(Date.UTC(y, m, 1, RUN_HOUR_UTC))

    return run > now ? run : new Date(Date.UTC(y, m + 1, 1, RUN_HOUR_UTC))
  }
  const step = cadence === 'weekly' ? 7 : 1
  const offset = cadence === 'weekly' ? (8 - now.getUTCDay()) % 7 : 0
  const run = new Date(Date.UTC(y, m, d + offset, RUN_HOUR_UTC))

  return run > now ? run : new Date(Date.UTC(y, m, d + offset + step, RUN_HOUR_UTC))
}

function zonedParts(date: Date, timeZone: string | undefined) {
  const map = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  )

  // Words in the app locale; the day number and clock time stay numeric.
  const shown = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(date)

  return {
    weekday: shown({ weekday: 'short' }),
    date: shown({ month: 'short', day: 'numeric' }),
    isFirst: map.day === '1',
    time: `${map.hour}:${map.minute}`,
  }
}

export function describeCadence(
  cadence: DashboardCadence,
  now: Date = new Date(),
  timeZone?: string,
): string {
  const { weekday, time, isFirst } = zonedParts(nextCadenceRun(cadence, now), timeZone)

  if (cadence === 'daily') return t('Daily at 09:00 UTC ({time} your time)', { time })
  if (cadence === 'weekly')
    return t('Weekly on Monday at 09:00 UTC ({weekday} {time} your time)', { weekday, time })

  return isFirst
    ? t('Monthly on the 1st at 09:00 UTC (the 1st at {time} your time)', { time })
    : t('Monthly on the 1st at 09:00 UTC (the day before at {time} your time)', { time })
}

export function describeNextRefresh(iso: string, timeZone?: string): string {
  const at = new Date(iso)
  const local = zonedParts(at, timeZone)
  const utc = zonedParts(at, 'UTC')

  return t('Next refresh: {weekday}, {date}, {time} ({utcDate}, {utcTime} UTC)', {
    weekday: local.weekday,
    date: local.date,
    time: local.time,
    utcDate: utc.date,
    utcTime: utc.time,
  })
}
