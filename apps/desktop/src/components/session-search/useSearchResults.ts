import { useEffect, useRef, useState } from 'react'

import { api, parseAtlasError } from '../../api.ts'
import { readSessionHistory } from '../../lib/sessionHistory.ts'

import type { AgentConversation } from '../../api.ts'
import type { TeamMember } from '../../types'

export type SessionResult = { conversation: AgentConversation; openedAt?: number }

/**
 * The last recently-opened list per person and team, so ⌘K opens on it at once
 * and refreshes in place instead of opening empty and growing.
 */
const recentCache = new Map<string, SessionResult[]>()

/** Mounted per query: an obsolete request can never populate a newer search. */
export function useSearchResults(
  teamId: string,
  userId: string,
  mode: 'sessions' | 'people',
  query: string,
  loadPeople: () => Promise<TeamMember[]>,
  ownerId?: string,
) {
  const recent = mode === 'sessions' && !query && !ownerId
  const cacheKey = `${userId}:${teamId}`
  const cached = recent ? recentCache.get(cacheKey) : undefined
  const [sessions, setSessions] = useState<SessionResult[]>(cached ?? [])
  const [people, setPeople] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState(false)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [retry, setRetry] = useState(0)
  const moreInFlight = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    let cancelled = false

    mounted.current = true
    async function load() {
      if (mode === 'people') {
        const members = await loadPeople()

        if (!cancelled)
          setPeople(
            members.filter(
              (member) =>
                !member.removedAt &&
                `${member.name} ${member.email}`
                  .toLocaleLowerCase()
                  .includes(query.toLocaleLowerCase()),
            ),
          )
      } else if (recent) {
        // Persist IDs only, and recheck access before showing any metadata. Use
        // the raw detail API so previewing a result doesn't mark its messages read.
        const visits = readSessionHistory(userId, teamId)
        const results = await Promise.allSettled(
          visits.map(async (visit) => ({
            conversation: await window.api.agentGetConversation(visit.sessionId, teamId, {
              tail: 1,
              runtimeState: 'omit',
            }),
            openedAt: visit.openedAt,
          })),
        )

        if (cancelled) return
        const shown = results.flatMap((result) =>
          result.status === 'fulfilled' &&
          !result.value.conversation.archivedAt &&
          !result.value.conversation.triggerRun
            ? [result.value]
            : [],
        )

        recentCache.set(cacheKey, shown)
        setSessions(shown)
        // A temporary failure must not look like an empty history.
        setError(
          results.some(
            (result) =>
              result.status === 'rejected' &&
              !['not_found', 'forbidden'].includes(parseAtlasError(result.reason).code ?? ''),
          ),
        )
      } else {
        const page = await api.agentListConversations(teamId, {
          scope: 'team',
          ownerId,
          search: query || undefined,
          archived: 'exclude',
          limit: 30,
        })

        if (cancelled) return
        setSessions(page.conversations.map((conversation) => ({ conversation })))
        setCursor(page.hasMore ? page.nextCursor : null)
      }
    }
    void load()
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      mounted.current = false
    }
  }, [teamId, userId, mode, query, ownerId, recent, retry, loadPeople, cacheKey])

  async function loadMore() {
    if (!cursor || moreInFlight.current) return
    moreInFlight.current = true
    setLoadingMore(true)
    setError(false)
    try {
      const page = await api.agentListConversations(teamId, {
        scope: 'team',
        ownerId,
        search: query || undefined,
        archived: 'exclude',
        limit: 30,
        cursor,
      })

      if (!mounted.current) return
      setSessions((previous) => {
        const seen = new Set(previous.map((item) => item.conversation.sessionId))

        return [
          ...previous,
          ...page.conversations
            .filter((item) => !seen.has(item.sessionId))
            .map((conversation) => ({ conversation })),
        ]
      })
      setCursor(page.hasMore ? page.nextCursor : null)
    } catch {
      if (mounted.current) setError(true)
    } finally {
      moreInFlight.current = false
      if (mounted.current) setLoadingMore(false)
    }
  }

  return {
    sessions,
    people,
    loading,
    error,
    recent,
    hasMore: Boolean(cursor),
    loadingMore,
    loadMore,
    retry: () => {
      if (cursor) {
        void loadMore()

        return
      }
      setLoading(true)
      setError(false)
      setRetry((value) => value + 1)
    },
  }
}
