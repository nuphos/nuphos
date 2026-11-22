import { createHash } from 'node:crypto'

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

/**
 * The 5-field schedule with a leading seconds field from 0 to 50, the same for the same id.
 * Triggers due in one minute then start spread over it, not all at its first instant.
 */
export function spreadWithinMinute(id: string, expression: string): string {
  const second = createHash('sha256').update(id).digest().readUInt32BE(0) % 51

  return `${String(second)} ${expression.trim()}`
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
