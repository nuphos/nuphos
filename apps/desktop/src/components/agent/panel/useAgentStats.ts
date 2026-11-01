import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { useCurrentUser } from '../../../hooks/useCurrentUser'

import { REFRESH_MS, createStatsCache } from './agentStatsCache'

import type { AgentStats, TeamActivityRange, AgentStatsScope } from '../../../types/team.ts'

const cache = createStatsCache((teamId, query) => api.atlasGetAgentStats(teamId, query))

/** The viewer's own time zone, so days and hours are theirs, not the server's. */
const viewerTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

/**
 * The numbers a metric card shows for the signed-in user, refreshed every few
 * minutes. `stats` is null until the first answer for this range and scope
 * arrives; `failed` says the last read for them did not, so a card can tell
 * that apart from loading. Signing out forgets every answer.
 */
export function useAgentStats(teamId: string, range: TeamActivityRange, scope: AgentStatsScope) {
  const userId = useCurrentUser()?.id ?? ''
  const key = `${userId}|${teamId}|${range}|${scope}`
  // Both kept with the query they answer, so switching range or scope shows
  // the skeleton until the new numbers arrive, never the old numbers or error.
  const [loaded, setLoaded] = useState<{ key: string; stats: AgentStats } | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) cache.clear()
  }, [userId])

  useEffect(() => {
    if (!userId) return
    let alive = true
    const answering = `${userId}|${teamId}|${range}|${scope}`
    const refresh = () =>
      void cache.load(userId, teamId, { range, scope, timeZone: viewerTimeZone() }).then(
        (stats) => {
          if (!alive) return
          setLoaded({ key: answering, stats })
          setFailedKey(null)
        },
        () => alive && setFailedKey(answering),
      )

    refresh()
    const timer = setInterval(refresh, REFRESH_MS)

    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [userId, teamId, range, scope])

  return { stats: loaded?.key === key ? loaded.stats : null, failed: failedKey === key }
}
