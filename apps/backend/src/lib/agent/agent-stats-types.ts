import type { ActivityRange } from './team-activity'

/** The heatmap's ranges: a rolling 24 hours, 7 days or 30 days. */
export type StatsRange = ActivityRange

/** `me` counts the viewer's own sessions, `team` everyone's. */
export type StatsScope = 'me' | 'team'

/** A session the viewer may open, or null when it is not theirs to see. */
export type SessionRef = { id: string; title: string } | null

export type StatTotals = {
  /** Summed turn time; sessions running side by side add up. */
  agentMs: number
  turns: number
  /** Sessions started, sub-agents not included. */
  sessions: number
  /** Sessions started by another session. */
  subAgents: number
  /** Pull requests linked to a session. */
  prsOpened: number
  prsMerged: number
  /** Merged between midnight and 7 in the viewer's time zone. */
  prsMergedOvernight: number
}

export type AgentStats = {
  range: StatsRange
  scope: StatsScope
  timeZone: string
  current: StatTotals
  /** The same totals for the period of the same length just before. */
  previous: StatTotals
  /** Days in a row with a turn, ending today (or yesterday), within the lookback. */
  streak: { current: number; best: number; lookbackDays: number }
  longest: { ms: number; startedAt: string; session: SessionRef } | null
  /** The session that started the most sub-agents in the range. */
  fanOut: { count: number; session: SessionRef } | null
  /** The most turns running at once in the range. */
  peak: { count: number; at: string } | null
  /** Turn time per agent runtime, largest first. */
  runtimes: { runtime: string | null; agentMs: number }[]
  /** Only the most recently active sessions were read, so the numbers may be low. */
  capped: boolean
}
