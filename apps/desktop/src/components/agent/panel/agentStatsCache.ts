import type { AgentStats, AgentStatsQuery } from '../../../types/team.ts'

// The server reuses one scan for five minutes; asking sooner gains nothing.
export const REFRESH_MS = 5 * 60_000

/**
 * One request per signed-in user, team and query at a time, so cards asking
 * the same thing share it and two users never share an answer.
 */
export function createStatsCache(
  fetchStats: (teamId: string, query: AgentStatsQuery) => Promise<AgentStats>,
  now: () => number = Date.now,
) {
  const pending = new Map<string, { at: number; stats: Promise<AgentStats> }>()

  return {
    load(userId: string, teamId: string, query: AgentStatsQuery): Promise<AgentStats> {
      const key = [userId, teamId, query.range, query.scope, query.timeZone].join('|')
      const hit = pending.get(key)

      if (hit && now() - hit.at < REFRESH_MS) return hit.stats
      const stats = fetchStats(teamId, query)

      pending.set(key, { at: now(), stats })
      stats.catch(() => {
        if (pending.get(key)?.stats === stats) pending.delete(key)
      })

      return stats
    },
    /** Forgets every answer, e.g. on sign-out. */
    clear() {
      pending.clear()
    },
  }
}
