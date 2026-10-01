import cronParser from 'cron-parser'

import type { ScheduleEvent } from './model'
import type { AgentConversation, AgentTrigger } from '../../../api'

// Safety valve for pathological schedules (`* * * * *` over the month strip's
// ~18 rendered weeks is ~180k occurrences). Real triggers are hourly at worst
// (~3k over that range, under the cap), so this only ever bites hand-written
// every-minute expressions.
const MAX_OCCURRENCES_PER_TRIGGER = 5000

/**
 * All fire times of `expression` inside [start, end), expanded with the same
 * cron-parser the backend validates expressions with — so anything the server
 * accepted renders, and anything it rejected quietly renders nothing.
 *
 * The scheduler evaluates every expression in UTC, so these are real UTC
 * instants; the grids draw them on the viewer's clock.
 */
export function cronOccurrencesInRange(expression: string, start: Date, end: Date): Date[] {
  const occurrences: Date[] = []

  try {
    // currentDate is exclusive, so step back 1ms to include a fire exactly at
    // range start; endDate is inclusive, so drop a fire exactly at range end.
    const interval = cronParser.parseExpression(expression, {
      currentDate: new Date(start.getTime() - 1),
      endDate: end,
      tz: 'UTC',
    })

    while (occurrences.length < MAX_OCCURRENCES_PER_TRIGGER) {
      const next = interval.next().toDate()

      if (next >= end) break
      occurrences.push(next)
    }
  } catch {
    // Iteration past endDate throws — that is the normal loop exit. A parse
    // failure lands here too and yields no occurrences, matching how an
    // invalid expression never fires.
  }

  return occurrences
}

/**
 * The visible range's events: one per fire time of each cron trigger. Disabled
 * triggers are included with `enabled: false` — they won't fire, but the
 * grids render them hollow (dashed outline) so their schedule stays visible.
 */
export function buildScheduleEvents(
  triggers: AgentTrigger[],
  start: Date,
  end: Date,
): ScheduleEvent[] {
  const events: ScheduleEvent[] = []

  for (const trigger of triggers) {
    if (trigger.triggerType !== 'cron') continue
    const expression = trigger.cronExpression?.trim()

    if (!expression) continue
    for (const fireAt of cronOccurrencesInRange(expression, start, end)) {
      events.push({
        key: `${trigger.id}@${String(fireAt.getTime())}`,
        triggerId: trigger.id,
        name: trigger.name,
        start: fireAt,
        enabled: trigger.enabled,
        kind: 'cron',
      })
    }
  }

  return sortEvents(events)
}

/**
 * Received webhook events: one per conversation a webhook trigger fired,
 * placed at the moment the request arrived. Always solid (`enabled: true`) —
 * these happened, so a paused trigger's past runs don't render hollow.
 */
export function buildWebhookRunEvents(
  triggers: AgentTrigger[],
  conversations: AgentConversation[],
): ScheduleEvent[] {
  const webhookTriggers = new Map(
    triggers.filter((trigger) => trigger.triggerType === 'webhook').map((t) => [t.id, t]),
  )
  const events: ScheduleEvent[] = []

  for (const conversation of conversations) {
    const trigger = conversation.triggerRun && webhookTriggers.get(conversation.triggerRun.id)

    if (!trigger) continue
    const receivedAt = new Date(conversation.createdAt)

    if (Number.isNaN(receivedAt.getTime())) continue
    events.push({
      key: `run:${conversation.sessionId}`,
      triggerId: trigger.id,
      name: trigger.name,
      start: receivedAt,
      enabled: true,
      kind: 'webhook',
    })
  }

  return sortEvents(events)
}

/** The grid layouts expect events ordered by start time. */
export function sortEvents(events: ScheduleEvent[]): ScheduleEvent[] {
  return events.sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.name.localeCompare(b.name),
  )
}

/** The next `count` fire times strictly after `after` — the detail panel's
 *  "Upcoming runs" list. */
export function nextOccurrencesAfter(expression: string, after: Date, count: number): Date[] {
  try {
    const interval = cronParser.parseExpression(expression, { currentDate: after, tz: 'UTC' })

    return Array.from({ length: count }, () => interval.next().toDate())
  } catch {
    return []
  }
}

// ────────────────────── Time-grid lane layout ──────────────────────
// A cron fire is an instant; the grid draws it as a fixed-height chip spanning
// SLOT_MINUTES. Chips whose slots overlap share the column width, Notion-style.
export const SLOT_MINUTES = 30

export type PositionedEvent = { event: ScheduleEvent; lane: number; laneCount: number }

/** Lay out one day column's events (already sorted by start time). */
export function layoutDayEvents(events: ScheduleEvent[]): PositionedEvent[] {
  const positioned: PositionedEvent[] = []
  // laneEnds[i] = when lane i frees up, within the current overlap cluster.
  let laneEnds: number[] = []
  let clusterStart = 0

  for (const event of events) {
    const startMs = event.start.getTime()
    const endMs = startMs + SLOT_MINUTES * 60_000

    if (laneEnds.every((laneEnd) => laneEnd <= startMs)) {
      // Nothing still running — close the cluster and give every chip in it
      // the cluster's final lane count so widths line up.
      for (let i = clusterStart; i < positioned.length; i++) {
        positioned[i] = { ...positioned[i], laneCount: laneEnds.length }
      }
      laneEnds = []
      clusterStart = positioned.length
    }

    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= startMs)

    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(endMs)
    } else {
      laneEnds[lane] = endMs
    }
    positioned.push({ event, lane, laneCount: 0 })
  }
  for (let i = clusterStart; i < positioned.length; i++) {
    positioned[i] = { ...positioned[i], laneCount: laneEnds.length }
  }

  return positioned
}
