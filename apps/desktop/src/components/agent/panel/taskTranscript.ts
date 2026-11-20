import { api } from '../../../api.ts'
import { queryKeys } from '../../../lib/query/keys.ts'

import type { AgentConversationDetail } from '../../../api.ts'
import type { QueryClient } from '@tanstack/react-query'

// Opening a conversation fetches only this many trailing messages — about a
// screenful of turns; earlier pages stream in as the user scrolls up (see
// loadEarlierMessages). A turn can carry megabytes of tool output, so every
// extra message here is paid for before first paint.
export const CONVERSATION_TAIL_LIMIT = 30

/** A Task's tail, without the runtime state: the session list publishes it. */
export function readTask(teamId: string | undefined, sessionId: string) {
  return api.agentGetConversation(sessionId, teamId, {
    tail: CONVERSATION_TAIL_LIMIT,
    runtimeState: 'omit',
  })
}

/**
 * The transcript a Task last showed, if it has no reply in progress: one with a reply in
 * progress opens from a fresh read, which resumes its stream.
 */
export function cachedTask(client: QueryClient, teamId: string | undefined, sessionId: string) {
  if (!teamId) return undefined
  const detail = client.getQueryData<AgentConversationDetail>(queryKeys.task(teamId, sessionId))

  return detail?.activeRun ? undefined : detail
}

/** Reads a Task before it is opened, once, so the click shows it from memory. */
export function prefetchTask(client: QueryClient, teamId: string, sessionId: string) {
  const queryKey = queryKeys.task(teamId, sessionId)

  if (client.getQueryState(queryKey)) return
  client
    .query({ queryKey, queryFn: () => readTask(teamId, sessionId), retry: false })
    .catch(() => {})
}
