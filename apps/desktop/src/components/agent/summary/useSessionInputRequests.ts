import { useEffect } from 'react'

import { getRuntimeStates, subscribeRuntimeStates } from '../../../lib/agentRuntimeStates.ts'
import { refreshInputRequests, runtimeStatesKey } from '../../../lib/inputRequestRefresh.ts'
import { useAnsweredOnDevice, useInboxListing } from '../../../views/inbox/useInbox.ts'
import { useAgentSessions } from '../../sidebar/agentSessions.ts'

import { openQuestionsUnder, relatedSessionIds } from './sessionInputRequests.ts'

/**
 * The open questions of a session and every agent under it that the viewer may
 * answer, as a Task page and a Bot's chat show them: read from the shared
 * pending listing alone, so they never draw a cached row's old question. Cached
 * rows only say who sits under whom.
 */
export function useSessionInputRequests(sessionId: string | null, teamId: string | undefined) {
  // Opening another session shows the last listing at once, and reloads it.
  // Streams, replies, dismissals, focus and runtime changes reload it at once.
  const listing = useInboxListing(teamId ?? '', sessionId)
  const pending = listing.data ?? null
  const failed = listing.isError
  const known = useAgentSessions(teamId ?? '').data
  const answered = useAnsweredOnDevice()
  const rows = [...(known ?? []), ...(pending ?? [])]
  // Shared sessions: whoever may reply in a conversation may answer its questions.
  const replyable = pending?.filter((conversation) => !conversation.readOnly)
  const requests =
    sessionId && replyable ? openQuestionsUnder(sessionId, replyable, known ?? [], answered) : []

  // A sub-agent starting, stopping or waiting is when it asks or takes an answer.
  useRefreshOnRuntimeChange(
    sessionId
      ? [...relatedSessionIds(sessionId, rows)].sort((a, b) => a.localeCompare(b)).join(',')
      : '',
  )

  return { requests, failed, loaded: pending !== null }
}

/**
 * Reloads the open questions when one of these sessions (comma-joined, sorted)
 * starts, stops or waits: when a sub-agent asks or takes an answer.
 */
function useRefreshOnRuntimeChange(watched: string) {
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
}
