import { useEffect, useState } from 'react'

import { api } from '../../api'
import { readSwrCache } from '../../lib/swrCache'
import { agentSessionsCacheKey } from '../sidebar/state'

import type { AgentConversation } from '../../api'

// What is known to be a channel, so opening one never shows an agent first.
const known = new Map<string, boolean>()

/** A channel just created, before the sidebar has listed it. */
export function markChannel(sessionId: string) {
  known.set(sessionId, true)
}

function cached(teamId: string, sessionId: string): boolean | undefined {
  if (known.has(sessionId)) return known.get(sessionId)
  const listed = readSwrCache<AgentConversation[]>(agentSessionsCacheKey(teamId))?.find(
    (conversation) => conversation.sessionId === sessionId,
  )

  return listed ? listed.kind === 'channel' : undefined
}

/** Whether a session is a channel: from what is cached, else from its detail. */
export function useIsChannel(teamId: string | undefined, sessionId: string | null | undefined) {
  const [, setChecked] = useState(0)
  const answer = teamId && sessionId ? cached(teamId, sessionId) : false

  useEffect(() => {
    if (!teamId || !sessionId || answer !== undefined) return
    let live = true

    api
      .agentGetConversation(sessionId, teamId, { tail: 1, messages: 'omit', runtimeState: 'omit' })
      .then(
        (detail) => {
          known.set(sessionId, detail.kind === 'channel')
          if (live) setChecked((n) => n + 1)
        },
        () => {
          // Unknown stays an agent conversation, as before channels.
        },
      )

    return () => {
      live = false
    }
  }, [teamId, sessionId, answer])

  return answer === true
}
