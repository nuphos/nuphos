import { api } from '../../api.ts'

const PAGE_LIMIT = 200
const MAX_PAGES = 25

/**
 * Every chat this person can still open in the team, active or archived, owned or
 * shared; null when the listing can't be read completely, so nothing is pruned on
 * a partial picture.
 */
export async function reachableSessionIds(teamId: string): Promise<Set<string> | null> {
  const ids = new Set<string>()

  for (const scope of ['mine', 'shared'] as const) {
    for (const archived of [undefined, 'only'] as const) {
      let cursor: string | undefined

      for (let page = 0; ; page += 1) {
        if (page >= MAX_PAGES) return null
        const result = await api.agentListConversations(teamId, {
          scope,
          archived,
          limit: PAGE_LIMIT,
          cursor,
        })

        for (const conversation of result.conversations) ids.add(conversation.sessionId)
        if (!result.hasMore || !result.nextCursor) break
        cursor = result.nextCursor
      }
    }
  }

  return ids
}
