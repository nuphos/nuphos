import { api } from '../../../api.ts'
import { queryKeys } from '../../../lib/query/keys.ts'

import { CONVERSATION_TAIL_LIMIT } from './model.ts'

import type { AgentConversationDetail } from '../../../api.ts'
import type { QueryClient } from '@tanstack/react-query'

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
