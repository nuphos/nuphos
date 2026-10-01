import { api } from '../../../api'

// ADR-0007 #2: "this answer used these memories", each removable inline.
// One attribution fetch per conversation instead of one per ribbon: opening a
// long history conversation would otherwise fire N parallel requests at once.
// Ribbons share the in-flight promise and pick their own turnKey out of the
// session-wide result; a short staleness window lets a revisited conversation
// pick up new turns without re-fetching on every mount.
export const SESSION_TIERS_STALE_MS = 30_000
export const sessionTierCache = new Map<
  string,
  { fetchedAt: number; promise: Promise<Map<string, Record<string, string>>> }
>()

export function fetchSessionTiers(
  sessionId: string,
  teamId: string | undefined,
  opts?: { fresh?: boolean },
): Promise<Map<string, Record<string, string>>> {
  const key = `${sessionId}|${teamId ?? ''}`
  const hit = sessionTierCache.get(key)

  if (hit && !opts?.fresh && Date.now() - hit.fetchedAt < SESSION_TIERS_STALE_MS) {
    return hit.promise
  }
  const promise = api
    .agentGetMemoryAttribution(sessionId, teamId)
    .then((page) => {
      const byTurn = new Map<string, Record<string, string>>()

      for (const row of page.rows) {
        if (!row.turnKey) continue
        const turn = byTurn.get(row.turnKey) ?? {}

        turn[row.memoryId] = row.tier
        byTurn.set(row.turnKey, turn)
      }

      return byTurn
    })
    .catch((err: unknown) => {
      // Failed fetches must not be cached as an empty session.
      if (sessionTierCache.get(key)?.promise === promise) sessionTierCache.delete(key)
      throw err
    })

  sessionTierCache.set(key, { fetchedAt: Date.now(), promise })

  return promise
}
