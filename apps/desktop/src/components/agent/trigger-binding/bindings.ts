import { t } from '../../../i18n/index.ts'
import { nextOccurrencesAfter } from '../../../views/triggers/calendar/occurrences.ts'
import { parseCron, WEEKDAYS } from '../../../views/triggers/cron.ts'
import { utcTimeOfDayInZone } from '../../../views/triggers/cronTime.ts'
import { cardSchedule } from '../panel/triggerSchedule.ts'

import type { AgentTrigger } from '../../../api/agent-trigger-types'

/** Every Trigger bound to a conversation, by that conversation: one list read feeds every row. */
export function bindingsBySession(triggers: readonly AgentTrigger[]): Map<string, AgentTrigger[]> {
  const map = new Map<string, AgentTrigger[]>()

  for (const trigger of triggers) {
    // One being torn down no longer fires, so it no longer marks its conversation.
    if (!trigger.targetSessionId || trigger.cleanupStatus === 'deleting') continue
    const list = map.get(trigger.targetSessionId) ?? []

    list.push(trigger)
    map.set(trigger.targetSessionId, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
  }

  return map
}

/** The Triggers bound to any of these conversations (a Bot's chat and its own Task), once each. */
export function triggersForSessions(
  map: ReadonlyMap<string, AgentTrigger[]>,
  sessionIds: readonly (string | undefined)[],
): AgentTrigger[] {
  const seen = new Set<string>()
  const found: AgentTrigger[] = []

  for (const id of sessionIds) {
    for (const trigger of (id ? map.get(id) : undefined) ?? []) {
      if (seen.has(trigger.id)) continue
      seen.add(trigger.id)
      found.push(trigger)
    }
  }

  return found
}

/** When a running cron Trigger fires next. Paused ones and webhooks have no next run. */
export function nextRunOf(trigger: AgentTrigger, now: Date): Date | null {
  if (!trigger.enabled || trigger.triggerType !== 'cron' || !trigger.cronExpression) return null

  return nextOccurrencesAfter(trigger.cronExpression, now, 1)[0] ?? null
}

export type LastRunState = 'ok' | 'failed' | 'never'

/**
 * How the last fire went, as far as the Trigger itself records it: a run that
 * could not act as its principal, or a failed cleanup, is a failure.
 */
export function lastRunState(trigger: AgentTrigger): LastRunState {
  if (trigger.executionAuthorizationStatus === 'invalid') return 'failed'
  if (trigger.cleanupStatus === 'cleanup_failed') return 'failed'

  return trigger.lastRunAt ? 'ok' : 'never'
}

function dayLabel(days: number[]): string {
  const key = [...days].sort((a, b) => a - b).join()

  if (days.length === 7) return t('Every day')
  if (key === '1,2,3,4,5') return t('Weekdays')
  if (key === '0,6') return t('Weekends')

  return WEEKDAYS.filter((day) => days.includes(day.value))
    .map((day) => day.short)
    .join(', ')
}

/** A schedule short enough for a chip, on the viewer's clock: "Every hour", "Weekdays at 09:00". */
export function shortSchedule(trigger: AgentTrigger, timeZone: string, now: Date): string {
  if (trigger.triggerType !== 'cron') return t('Webhook')
  const expr = (trigger.cronExpression ?? '').trim()
  const mode = parseCron(expr)

  if (mode.kind !== 'at-time') return cardSchedule(expr, timeZone, now)
  const { hm, dayShift } = utcTimeOfDayInZone(mode.hour, mode.minute, timeZone, now)
  const days = mode.days.map((day) => (day + dayShift + 7) % 7)

  return t('{days} at {time}', { days: dayLabel(days), time: hm })
}

function sameDay(a: Date, b: Date, timeZone: string): boolean {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' })

  return day.format(a) === day.format(b)
}

/** "17:00" today, "Tue 17:00" on another day, always on the viewer's clock. */
export function runClock(at: Date, now: Date, timeZone: string, locale?: string): string {
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at)

  if (sameDay(at, now, timeZone)) return time
  const day = new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short' }).format(at)

  return `${day} ${time}`
}

/** The Scheduled row's quiet note: "next 18:00", "next Mon 09:00", or "Paused". */
export function scheduledNote(
  trigger: AgentTrigger,
  now: Date,
  timeZone: string,
  locale?: string,
): string {
  if (!trigger.enabled) return t('Paused')
  const next = nextRunOf(trigger, now)

  return next ? t('next {time}', { time: runClock(next, now, timeZone, locale) }) : ''
}

/** The Scheduled section's order: the soonest to fire first, then webhooks, then paused ones. */
export function sortForSchedule(triggers: readonly AgentTrigger[], now: Date): AgentTrigger[] {
  const rank = (trigger: AgentTrigger) => {
    if (!trigger.enabled) return Number.MAX_SAFE_INTEGER
    const next = nextRunOf(trigger, now)

    return next ? next.getTime() : Number.MAX_SAFE_INTEGER - 1
  }

  return [...triggers].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

/** One line per Trigger for the sidebar's clock tooltip. */
export function clockTooltipLines(
  triggers: readonly AgentTrigger[],
  now: Date,
  timeZone: string,
  locale?: string,
): string[] {
  return triggers.map((trigger) => {
    const schedule = shortSchedule(trigger, timeZone, now)
    const next = nextRunOf(trigger, now)
    let when = trigger.enabled ? '' : t('Paused')

    if (next) when = t('next {time}', { time: runClock(next, now, timeZone, locale) })

    return [trigger.name, schedule, when].filter(Boolean).join(' · ')
  })
}

/** Every bound Trigger is paused: the mark goes faint. */
export function allPaused(triggers: readonly AgentTrigger[]): boolean {
  return triggers.length > 0 && triggers.every((trigger) => !trigger.enabled)
}
