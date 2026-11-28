import { t } from '../../i18n/index.ts'

/** Read-only descriptions; these never change the cron builder or stored rule. */
export function commonCronSummary(
  expression: string,
  time: (hour: number, minute: number) => string,
  zone: string,
): string | null {
  const fields = expression.split(/\s+/)

  if (fields.length !== 5) return null
  const [minute, hour, day, month, weekday] = fields

  // Restrict to full-hour divisors: */7 resets each hour, not every 7 minutes.
  if (hour === '*' && day === '*' && month === '*' && weekday === '*') {
    const step = minute === '*' ? 1 : Number(/^\*\/(\d+)$/.exec(minute)?.[1])

    if ([1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30].includes(step))
      return step === 1
        ? t('Runs every minute ({zone})', { zone })
        : t('Runs every {n} minutes, from minute 00 ({zone})', { n: step, zone })
  }
  // DOM and DOW together have OR semantics; never describe that as monthly.
  if (month !== '*' || weekday !== '*') return null
  if (![minute, hour, day].every((field) => /^\d+$/.test(field))) return null
  const [m, h, d] = [Number(minute), Number(hour), Number(day)]

  if (m > 59 || h > 23 || d < 1 || d > 31) return null

  if (d >= 29)
    return t('Runs on day {day} of each month at {time}; skips months without that date', {
      day: d,
      time: time(h, m),
    })

  return t('Runs on day {day} of each month at {time}', { day: d, time: time(h, m) })
}
