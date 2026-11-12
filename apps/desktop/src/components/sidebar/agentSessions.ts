import { useQuery } from '@tanstack/react-query'

import { api } from '../../api.ts'
import { queryKeys } from '../../lib/query/keys.ts'

import { loadSidebarChats } from './load-sidebar-chats.ts'
import { AGENT_SESSIONS_POLL_MS } from './state.ts'

import type { AgentConversation } from '../../api/agent-types.ts'
import type { QueryClient } from '@tanstack/react-query'

type Rows = AgentConversation[]

/** The team's Chats, newest activity first; undefined until listed once. */
export function useAgentSessions(teamId: string) {
  return useQuery({
    queryKey: queryKeys.agentSessions(teamId),
    queryFn: async () => {
      const rows = await loadSidebarChats(
        (options) => api.agentListConversations(teamId, options),
        () => true,
      )

      return (rows ?? []).filter((row) => !row.archivedAt)
    },
    enabled: Boolean(teamId),
    refetchInterval: AGENT_SESSIONS_POLL_MS,
  })
}

/** Changes the listed rows now, then lists again. A listing already running may predate the
 *  change, so it is dropped first: only one asked for after the change can replace these rows. */
async function relist(client: QueryClient, teamId: string, change: (rows: Rows) => Rows) {
  const queryKey = queryKeys.agentSessions(teamId)

  await client.cancelQueries({ queryKey })
  client.setQueryData<Rows>(queryKey, (rows) => rows && change(rows))
  await client.invalidateQueries({ queryKey })
}

/** An archived chat leaves the list, and an older listing cannot bring it back. */
export const removeChat = (client: QueryClient, teamId: string, sessionId: string) =>
  relist(client, teamId, (rows) => rows.filter((row) => row.sessionId !== sessionId))

/** A chat put back by Undo lists again at once, in activity order. */
export const restoreChat = (client: QueryClient, teamId: string, restored: AgentConversation) =>
  relist(client, teamId, (rows) => {
    if (rows.some((row) => row.sessionId === restored.sessionId)) return rows
    const index = rows.findIndex((row) => row.lastActiveAt < restored.lastActiveAt)

    return rows.toSpliced(index === -1 ? rows.length : index, 0, restored)
  })

export const retitleChat = (
  client: QueryClient,
  teamId: string,
  sessionId: string,
  title: string,
) =>
  relist(client, teamId, (rows) =>
    rows.map((row) => (row.sessionId === sessionId ? { ...row, title } : row)),
  )
