export type DashboardCadence = 'daily' | 'weekly' | 'monthly'

export const CADENCE_LABELS: Record<DashboardCadence, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
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
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  )

  return {
    weekday: map.weekday,
    date: `${map.month} ${map.day}`,
    isFirst: map.day === '1',
    time: `${map.hour}:${map.minute}`,
  }
}

export function describeCadence(
  cadence: DashboardCadence,
  now: Date = new Date(),
  timeZone?: string,
): string {
  const local = zonedParts(nextCadenceRun(cadence, now), timeZone)

  if (cadence === 'daily') return `Daily at 09:00 UTC (${local.time} your time)`
  if (cadence === 'weekly')
    return `Weekly on Monday at 09:00 UTC (${local.weekday} ${local.time} your time)`

  return `Monthly on the 1st at 09:00 UTC (${local.isFirst ? 'the 1st' : 'the day before'} at ${local.time} your time)`
}

export function describeNextRefresh(iso: string, timeZone?: string): string {
  const at = new Date(iso)
  const local = zonedParts(at, timeZone)
  const utc = zonedParts(at, 'UTC')

  return `Next refresh: ${local.weekday}, ${local.date}, ${local.time} (${utc.date}, ${utc.time} UTC)`
}
