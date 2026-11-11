import cronParser from 'cron-parser'

/** Existing schedules default to UTC, whatever the host's zone. */
export const CRON_TIME_ZONE = 'UTC'

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format()

    return true
  } catch {
    return false
  }
}

export function parseUtcCron(expression: string, currentDate?: Date, timeZone = CRON_TIME_ZONE) {
  return cronParser.parseExpression(expression, {
    tz: timeZone,
    ...(currentDate ? { currentDate } : {}),
  })
}

/** Classic 5-field form only: cron-parser also accepts a leading seconds field. */
export function isValidCronExpression(expression: string): boolean {
  const trimmed = expression.trim()

  if (trimmed.split(/\s+/).length !== 5) return false
  try {
    parseUtcCron(trimmed)

    return true
  } catch {
    return false
  }
}

export function nextCronRun(expression: string, after: Date): Date {
  return parseUtcCron(expression, after).next().toDate()
}

export function nextCronRuns(expression: string, count = 3, timeZone = CRON_TIME_ZONE): string[] {
  try {
    const interval = parseUtcCron(expression, undefined, timeZone)

    return Array.from({ length: count }, () => interval.next().toISOString())
  } catch {
    return []
  }
}
