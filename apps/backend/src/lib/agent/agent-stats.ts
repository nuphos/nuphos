import { conversationAccess } from '@/lib/agent/db/access'

import { localDay, localHour, peakOverlap, streaks, zoneClock } from './agent-stats-time'
import { ACTIVITY_RANGES } from './team-activity'
import { recentTeamTurns } from './team-turns'

import type {
  AgentStats,
  SessionRef,
  StatTotals,
  StatsRange,
  StatsScope,
} from './agent-stats-types'
import type { RecentTurns, TurnSession } from './team-turns'

export { isTimeZone } from './agent-stats-time'

const DAY_MS = 24 * 60 * 60_000

/**
 * How far back the read goes: the longest range and the period before it,
 * which the trend compares against. Streaks are counted inside it too.
 */
export const LOOKBACK_DAYS = 2 * ACTIVITY_RANGES['30d'].days

// A merge before this local hour counts as overnight.
const OVERNIGHT_END_HOUR = 7

type Period = 'current' | 'previous'
type Pull = { key: string; linkedAt: number; mergedAt: number | null }

/** The range, rolling back from `end`, and the period of the same length before it. */
type Window = { start: number; end: number; length: number; local: (at: number) => number }

function periodAt(w: Window, at: number): Period | null {
  if (at > w.end || at < w.start - w.length) return null

  return at >= w.start ? 'current' : 'previous'
}

/** How much of a turn falls in a period. */
function overlapMs(w: Window, period: Period, [from, to]: [number, number]) {
  const start = period === 'current' ? w.start : w.start - w.length
  const end = period === 'current' ? w.end : w.start

  return Math.max(0, Math.min(to, end) - Math.max(from, start))
}

const emptyTotals = (): StatTotals => ({
  agentMs: 0,
  turns: 0,
  sessions: 0,
  subAgents: 0,
  prsOpened: 0,
  prsMerged: 0,
  prsMergedOvernight: 0,
})

/** Everything counted while walking the sessions once. */
function newTally() {
  return {
    totals: { current: emptyTotals(), previous: emptyTotals() },
    runtimes: new Map<string | null, number>(),
    activeDays: new Set<number>(),
    inRange: [] as [number, number][],
    children: new Map<string, number>(),
    pulls: new Map<string, Pull>(),
    longest: null as { ms: number; startedAt: number; session: TurnSession } | null,
  }
}

type Tally = ReturnType<typeof newTally>

function tallyTurn(t: Tally, w: Window, s: TurnSession, turn: [number, number]) {
  const [from, to] = turn
  const started = periodAt(w, from)
  const inRange = overlapMs(w, 'current', turn)

  if (started) t.totals[started].turns++
  t.totals.current.agentMs += inRange
  t.totals.previous.agentMs += overlapMs(w, 'previous', turn)
  if (inRange > 0) {
    t.inRange.push([Math.max(from, w.start), Math.min(to, w.end)])
    t.runtimes.set(s.agentRuntime ?? null, (t.runtimes.get(s.agentRuntime ?? null) ?? 0) + inRange)
  }
  if (started === 'current' && to - from > (t.longest?.ms ?? 0))
    t.longest = { ms: to - from, startedAt: from, session: s }
  for (let d = localDay(w.local(from)); d <= localDay(w.local(to)); d++) t.activeDays.add(d)
}

/**
 * A pull request linked from several sessions counts once, as linked when it
 * was first linked.
 */
function tallyLink(t: Tally, r: NonNullable<TurnSession['linkedResources']>[number]) {
  const seen = t.pulls.get(r.key)
  const linkedAt = Date.parse(r.linkedAt)
  const mergedAt = r.mergedAt ? Date.parse(r.mergedAt) : NaN

  // A time that does not parse is left out, never counted in either period.
  if (Number.isNaN(linkedAt) && !seen) return
  t.pulls.set(r.key, {
    key: r.key,
    linkedAt: Math.min(seen?.linkedAt ?? Infinity, Number.isNaN(linkedAt) ? Infinity : linkedAt),
    mergedAt: Number.isNaN(mergedAt) ? (seen?.mergedAt ?? null) : mergedAt,
  })
}

function tallySession(t: Tally, w: Window, { session: s, turns }: RecentTurns['sessions'][number]) {
  const started = periodAt(w, new Date(s.createdAt).getTime())

  if (started) t.totals[started][s.parentSessionId ? 'subAgents' : 'sessions']++
  if (started === 'current' && s.parentSessionId)
    t.children.set(s.parentSessionId, (t.children.get(s.parentSessionId) ?? 0) + 1)
  for (const r of s.linkedResources ?? []) if (r.provider === 'github') tallyLink(t, r)
  for (const turn of turns) tallyTurn(t, w, s, turn)
}

function tallyPull(t: Tally, w: Window, pull: Pull) {
  const opened = periodAt(w, pull.linkedAt)

  if (opened) t.totals[opened].prsOpened++
  if (pull.mergedAt === null) return
  const merged = periodAt(w, pull.mergedAt)

  if (!merged) return
  t.totals[merged].prsMerged++
  if (localHour(w.local(pull.mergedAt)) < OVERNIGHT_END_HOUR) t.totals[merged].prsMergedOvernight++
}

/** The parent with the most sub-agents, the first one found on a tie. */
function busiestParent(children: Map<string, number>): [string, number] | null {
  let best: [string, number] | null = null

  for (const entry of children) if (entry[1] > (best?.[1] ?? 0)) best = entry

  return best
}

/**
 * The numbers the metric cards show, from one read of the team's turns.
 * `team` counts every session, private ones included, but only names a
 * session the viewer may open; any other is a `null` reference.
 */
export function summarizeStats(
  read: Pick<RecentTurns, 'now' | 'sessions'> & { capped?: boolean },
  options: { viewerId: string; scope: StatsScope; range: StatsRange; timeZone: string },
): AgentStats {
  const { viewerId, scope, range, timeZone } = options
  const length = ACTIVITY_RANGES[range].days * DAY_MS
  const w: Window = { start: read.now - length, end: read.now, length, local: zoneClock(timeZone) }
  const t = newTally()
  const byId = new Map(read.sessions.map((s) => [s.session.sessionId, s.session]))
  const ref = (s: TurnSession | undefined): SessionRef =>
    s && conversationAccess(s, viewerId) ? { id: s.sessionId, title: s.title } : null

  for (const s of read.sessions)
    if (scope === 'team' || s.session.userId === viewerId) tallySession(t, w, s)
  for (const pull of t.pulls.values()) tallyPull(t, w, pull)
  const fanOut = busiestParent(t.children)
  const peak = peakOverlap(t.inRange)

  return {
    range,
    scope,
    timeZone,
    current: t.totals.current,
    previous: t.totals.previous,
    streak: streaks(t.activeDays, localDay(w.local(read.now)), LOOKBACK_DAYS),
    longest: t.longest && {
      ms: t.longest.ms,
      startedAt: new Date(t.longest.startedAt).toISOString(),
      session: ref(t.longest.session),
    },
    fanOut: fanOut && { count: fanOut[1], session: ref(byId.get(fanOut[0])) },
    peak: peak && { count: peak.count, at: new Date(peak.at).toISOString() },
    runtimes: [...t.runtimes]
      .map(([runtime, agentMs]) => ({ runtime, agentMs }))
      .sort((a, b) => b.agentMs - a.agentMs),
    capped: read.capped ?? false,
  }
}

/**
 * The metric cards' numbers for one viewer, from the team's turns over the
 * lookback: the viewer's own for `me`, read on their own so a busy team's
 * session limit never crowds them out.
 *
 * The heatmap keeps its own read: it needs at most 30 days, aligned to its
 * slots and cached per slot, while these numbers need 61 days for the trend
 * and the streak. Serving the heatmap from this read would scan twice the
 * days for its most common range.
 */
export async function getAgentStats(
  teamId: string,
  options: { viewerId: string; scope: StatsScope; range: StatsRange; timeZone: string },
  now = Date.now(),
): Promise<AgentStats> {
  const userId = options.scope === 'me' ? options.viewerId : undefined

  return summarizeStats(await recentTeamTurns(teamId, LOOKBACK_DAYS + 1, now, userId), options)
}
