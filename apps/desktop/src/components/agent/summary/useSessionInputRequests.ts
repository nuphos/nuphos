import { useEffect, useMemo, useState } from 'react'

import { api } from '../../../api.ts'
import { getRuntimeStates, subscribeRuntimeStates } from '../../../lib/agentRuntimeStates.ts'
import {
  onInputRequestsRefresh,
  refreshInputRequests,
  runtimeStatesKey,
} from '../../../lib/inputRequestRefresh.ts'
import { useOpenedConversation } from '../../../lib/openedConversation.ts'
import { useSwrCache } from '../../../lib/swrCache.ts'
import { agentSessionsCacheKey } from '../../sidebar/state.ts'

import { relatedSessionIds, sessionInputRequests } from './sessionInputRequests.ts'

import type { AgentConversation } from '../../../api/agent-types'

type Listing = { teamId: string; conversations: AgentConversation[] }
// The fallback: streams, replies, dismissals, focus and runtime changes reload at once.
const POLL_MS = 5_000

/**
 * The pending listing includes requests whose chats are beyond the sidebar's
 * first page. It reloads whenever a question may have changed, and polls.
 */
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
    let loading = false
    let again = false

    async function load() {
      loading = true
      window.clearTimeout(timer)
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
        loading = false
        if (live && again) {
          again = false
          void load()
        } else if (live) timer = window.setTimeout(() => void load(), POLL_MS)
      }
    }
    // A signal during a load may postdate what that load read: load once more after it.
    const refresh = () => {
      if (loading) again = true
      else void load()
    }
    const stopRefresh = onInputRequestsRefresh(refresh)

    window.addEventListener('focus', refresh)
    void load()

    return () => {
      live = false
      window.clearTimeout(timer)
      stopRefresh()
      window.removeEventListener('focus', refresh)
    }
  }, [sessionId, teamId])

  const { requests, watched } = useMemo(() => {
    if (!sessionId) return { requests: [], watched: '' }
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

    const conversations = [...rows.values()]

    return {
      requests: sessionInputRequests(sessionId, conversations),
      watched: [...relatedSessionIds(sessionId, conversations)]
        .sort((a, b) => a.localeCompare(b))
        .join(','),
    }
  }, [known, listing, opened, sessionId, teamId])

  // A sub-agent starting, stopping or waiting is when it asks or takes an answer.
  useEffect(() => {
    if (!watched) return
    const ids = watched.split(',')
    let seen = runtimeStatesKey(getRuntimeStates(), ids)

    return subscribeRuntimeStates(() => {
      const next = runtimeStatesKey(getRuntimeStates(), ids)

      if (next === seen) return
      seen = next
      refreshInputRequests()
    })
  }, [watched])

  return { requests, failed, loaded: listing?.teamId === teamId }
}
