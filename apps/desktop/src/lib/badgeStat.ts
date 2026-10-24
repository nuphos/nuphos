import { runtimeTurnActive } from './runtimeExecution.ts'

import type { RuntimeExecution } from './runtimeExecution.ts'
import type { AgentConversation } from '../api/agent-types.ts'
import type { RuntimeQuota } from '../types/runtime.ts'
import type { BadgeStat } from '../types/team.ts'

/** What the sidebar badge can count, in the order the picker lists them. */
export const BADGE_STATS: readonly BadgeStat[] = [
  'merged-prs',
  'running',
  'waiting',
  'quota',
  'none',
]

export const DEFAULT_BADGE_STAT: BadgeStat = 'merged-prs'

export const BADGE_STAT_INFO: Record<BadgeStat, { label: string; hint: string }> = {
  'merged-prs': {
    label: 'PRs merged',
    hint: 'PRs linked to your sessions that merged this month',
  },
  running: { label: 'Running', hint: 'Your sessions with a reply running now' },
  waiting: {
    label: 'Waiting on you',
    hint: 'Your sessions with a question or an approval for you',
  },
  quota: {
    label: 'Agent quota',
    hint: "How much of the 5-hour limit your latest session's agent has used",
  },
  none: { label: 'None', hint: 'Just your character' },
}

export type BadgeInputs = {
  sessions: readonly AgentConversation[]
  runtimeStates: ReadonlyMap<string, RuntimeExecution>
  quotas: ReadonlyMap<string, RuntimeQuota>
  /** PRs merged this month; null while unknown or when the server cannot count them. */
  mergedPrs: number | null
}

export type BadgeReading = {
  /** The badge text; absent hides the badge. */
  badge?: string
  /** How far the ring fills, 0 to 1, or null for a quiet full ring that is not progress. */
  fraction: number | null
  /** One line that says what the number means. */
  summary: string
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${String(count)} ${count === 1 ? one : many}`

function state(inputs: BadgeInputs, session: AgentConversation) {
  return inputs.runtimeStates.get(session.sessionId) ?? session.runtimeState
}

/** The person's own live sessions, most recently active first (the quota reads the latest). */
function ownSessions(inputs: BadgeInputs): AgentConversation[] {
  return inputs.sessions
    .filter((session) => session.isOwner === true && !session.archivedAt)
    .toSorted((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
}

export function isRunning(inputs: BadgeInputs, session: AgentConversation): boolean {
  return runtimeTurnActive(state(inputs, session)) || Boolean(session.activeRun)
}

/** A question asked through a decision, or a tool approval the runtime holds for the owner. */
export function isWaiting(inputs: BadgeInputs, session: AgentConversation): boolean {
  const runtime = state(inputs, session)

  return (
    Boolean(session.pendingDecision) ||
    Boolean(runtime?.requestPending) ||
    (runtime?.requests?.length ?? 0) > 0
  )
}

/** The 5-hour window of a quota: Claude names it `five_hour`, Codex `primary`. */
function fiveHourWindow(quota: RuntimeQuota | undefined) {
  return quota?.windows.find(
    (window) => window.id === 'five_hour' || window.id === 'primary' || window.label === '5-hour',
  )
}

export function readBadge(stat: BadgeStat, inputs: BadgeInputs): BadgeReading {
  switch (stat) {
    case 'merged-prs': {
      const count = inputs.mergedPrs

      if (count === null)
        return { fraction: null, summary: 'PRs merged this month are unavailable' }

      return {
        badge: String(count),
        fraction: null,
        summary: `${plural(count, 'PR')} merged this month, linked to your sessions`,
      }
    }
    case 'running': {
      const running = ownSessions(inputs).filter((session) => isRunning(inputs, session))

      return {
        badge: String(running.length),
        fraction: null,
        summary: `${plural(running.length, 'session')} running now`,
      }
    }
    case 'waiting': {
      const own = ownSessions(inputs)
      const waiting = own.filter((session) => isWaiting(inputs, session))
      const active = own.filter(
        (session) => isWaiting(inputs, session) || isRunning(inputs, session),
      ).length

      // Hidden at zero, so a number here always means something needs you.
      return {
        ...(waiting.length ? { badge: String(waiting.length) } : {}),
        fraction: active ? waiting.length / active : 0,
        summary: waiting.length
          ? `${plural(waiting.length, 'session')} waiting on you`
          : 'Nothing is waiting on you',
      }
    }
    case 'quota': {
      const latest = ownSessions(inputs).find((session) => session.runtimeId)
      const window = fiveHourWindow(
        latest?.runtimeId ? inputs.quotas.get(latest.runtimeId) : undefined,
      )

      if (!latest || !window)
        return { fraction: null, summary: 'No 5-hour limit to show for your agent' }
      const used = Math.round(Math.min(100, Math.max(0, window.usedPercent)))

      return {
        badge: `${String(used)}%`,
        fraction: used / 100,
        summary: `${String(used)}% of the 5-hour limit used on ${latest.runtimeLabel ?? 'your agent'}`,
      }
    }
    case 'none':
      return { fraction: null, summary: 'Just your character' }
  }
}
