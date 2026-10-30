import { useEffect, useState } from 'react'

import { api } from '../../api'
import { readSwrCache } from '../../lib/swrCache'
import { agentSessionsCacheKey } from '../sidebar/state'

import type { AgentConversation } from '../../api'

// What is known to be a channel, so opening one never shows an agent first.
const known = new Map<string, boolean>()

/**
 * A session whose kind is known before any list has it: a channel just created,
 * or a conversation the agent panel itself reports, which is never a channel.
 */
export function markChannel(sessionId: string, channel = true) {
  known.set(sessionId, channel)
}

function cached(teamId: string, sessionId: string): boolean | undefined {
  if (known.has(sessionId)) return known.get(sessionId)
  const listed = readSwrCache<AgentConversation[]>(agentSessionsCacheKey(teamId))?.find(
    (conversation) => conversation.sessionId === sessionId,
  )

  return listed ? listed.kind === 'channel' : undefined
}

// A failed check is tried again on this beat; until it answers, nothing is shown.
const RETRY_MS = 3_000

/**
 * Whether a session is a channel: from what is cached, else from its detail.
 * Undefined while unknown, so the caller shows neither view: a channel opened
 * as an agent would offer a composer that talks to no agent.
 */
export function useIsChannel(
  teamId: string | undefined,
  sessionId: string | null | undefined,
): boolean | undefined {
  const [attempt, setAttempt] = useState(0)
  const answer = teamId && sessionId ? cached(teamId, sessionId) : false

  useEffect(() => {
    if (!teamId || !sessionId || answer !== undefined) return
    let live = true
    let retry: number | undefined

    api
      .agentGetConversation(sessionId, teamId, { tail: 1, messages: 'omit', runtimeState: 'omit' })
      .then(
        (detail) => {
          known.set(sessionId, detail.kind === 'channel')
          if (live) setAttempt((n) => n + 1)
        },
        () => {
          if (live) retry = window.setTimeout(() => setAttempt((n) => n + 1), RETRY_MS)
        },
      )

    return () => {
      live = false
      window.clearTimeout(retry)
    }
  }, [teamId, sessionId, answer, attempt])

  return answer
}
