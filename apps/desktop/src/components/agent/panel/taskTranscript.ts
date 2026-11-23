import { api } from '../../../api.ts'
import { queryKeys } from '../../../lib/query/keys.ts'

import type {
  AgentConversation,
  AgentConversationDetail,
  AgentCredentialSelection,
} from '../../../api.ts'
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
 * The transcript a Task last showed, while it is still current: the session list, polled every
 * few seconds, shows the same messages and transcript revision. A Task that changed since, or
 * has a reply in progress, opens from a fresh read, so a stale copy never shows.
 */
export function cachedTask(client: QueryClient, teamId: string | undefined, sessionId: string) {
  if (!teamId) return undefined
  const detail = client.getQueryData<AgentConversationDetail>(queryKeys.task(teamId, sessionId))
  const row = client
    .getQueryData<AgentConversation[]>(queryKeys.agentSessions(teamId))
    ?.find((listed) => listed.sessionId === sessionId)

  if (!detail || !row || detail.activeRun) return undefined

  return row.messageCount === detail.messageCount &&
    (row.transcriptUpdatedAt ?? null) === (detail.transcriptUpdatedAt ?? null)
    ? detail
    : undefined
}

/**
 * A Task's selection saved outside it, as "Use in task" in the Inbox does: its copy takes it,
 * since that changes neither the messages nor the revision the copy is checked against.
 */
export function keepTaskSelection(
  client: QueryClient,
  teamId: string,
  sessionId: string,
  credentialAccess: AgentCredentialSelection,
) {
  const key = queryKeys.task(teamId, sessionId)
  const detail = client.getQueryData<AgentConversationDetail>(key)

  if (detail) client.setQueryData(key, { ...detail, credentialAccess })
}

/**
 * Reads a Task into its copy; one read already on the way (a prefetch) is joined, not repeated.
 * A copy already there is read again however recent: it is asked for only when behind (cachedTask).
 */
export function fetchTask(client: QueryClient, teamId: string, sessionId: string) {
  return client.query({
    queryKey: queryKeys.task(teamId, sessionId),
    queryFn: () => readTask(teamId, sessionId),
    staleTime: 0,
    retry: false,
  })
}

/**
 * Reads a Task before it is opened, unless its copy is current, so the click shows it from memory.
 * A copy with a reply in progress is skipped too: its tab streams it, and a click on it reads
 * afresh anyway, so reading it on hover only adds a read.
 */
export function prefetchTask(client: QueryClient, teamId: string, sessionId: string) {
  const copy = client.getQueryData<AgentConversationDetail>(queryKeys.task(teamId, sessionId))

  if (copy?.activeRun || cachedTask(client, teamId, sessionId)) return
  fetchTask(client, teamId, sessionId).catch(() => {})
}
