import cronParser from 'cron-parser'

/** Every schedule the backend stores or evaluates is UTC, whatever the host's zone. */
export const CRON_TIME_ZONE = 'UTC'

export function parseUtcCron(expression: string, currentDate?: Date) {
  return cronParser.parseExpression(expression, {
    tz: CRON_TIME_ZONE,
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

export function nextCronRuns(expression: string, count = 3): string[] {
  try {
    const interval = parseUtcCron(expression)

    return Array.from({ length: count }, () => interval.next().toISOString())
  } catch {
    return []
  }
}
