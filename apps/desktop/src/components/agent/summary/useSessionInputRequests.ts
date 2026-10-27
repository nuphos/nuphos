import { useEffect, useMemo, useState } from 'react'

import { api } from '../../../api.ts'
import { useOpenedConversation } from '../../../lib/openedConversation.ts'
import { useSwrCache } from '../../../lib/swrCache.ts'
import { agentSessionsCacheKey } from '../../sidebar/state.ts'

import { sessionInputRequests } from './sessionInputRequests.ts'

import type { AgentConversation } from '../../../api/agent-types'

type Listing = { teamId: string; conversations: AgentConversation[] }
const POLL_MS = 5_000

/** The pending listing includes requests whose chats are beyond the sidebar's first page. */
export function useSessionInputRequests(sessionId: string | null, teamId: string | undefined) {
  const known = useSwrCache<AgentConversation[]>(agentSessionsCacheKey(teamId ?? ''))
  const opened = useOpenedConversation(sessionId ?? '')
  const [listing, setListing] = useState<Listing | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!teamId || !sessionId) return
    const requestTeamId = teamId
    let live = true
    let timer: number | undefined

    async function load() {
      try {
        const conversations: AgentConversation[] = []
        const cursors = new Set<string>()
        let cursor: string | undefined

        do {
          const page = await api.agentListConversations(requestTeamId, {
            scope: 'team',
            pendingDecision: true,
            archived: 'exclude',
            limit: 100,
            cursor,
          })

          if (!live) return
          conversations.push(...page.conversations)
          cursor = page.nextCursor ?? undefined
          if (cursor && cursors.has(cursor)) throw new Error('Repeated input request page')
          if (cursor) cursors.add(cursor)
        } while (cursor)
        setListing({ teamId: requestTeamId, conversations })
        setFailed(false)
      } catch {
        if (live) setFailed(true)
      } finally {
        if (live) timer = window.setTimeout(() => void load(), POLL_MS)
      }
    }
    void load()

    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [sessionId, teamId])

  const requests = useMemo(() => {
    if (!sessionId) return []
    const rows = new Map(
      (known ?? []).map((conversation) => [conversation.sessionId, conversation]),
    )

    if (opened && opened.teamId === teamId) rows.set(opened.sessionId, opened)
    if (listing && listing.teamId === teamId) {
      // The pending listing is authoritative, including a request that was answered.
      for (const [id, conversation] of rows)
        rows.set(id, { ...conversation, pendingDecision: undefined })
      for (const conversation of listing.conversations)
        rows.set(conversation.sessionId, conversation)
    }

    return sessionInputRequests(sessionId, [...rows.values()])
  }, [known, listing, opened, sessionId, teamId])

  return { requests, failed, loaded: listing?.teamId === teamId }
}
