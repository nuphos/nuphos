import { queryClient } from '../../../lib/query/client.ts'
import { queryKeys } from '../../../lib/query/keys.ts'

import type { AgentConversation } from '../../../api.ts'

/** Whether the session list, polled every few seconds, publishes this session's runtime state. */
export function listsRuntimeState(teamId: string | undefined, sessionId: string): boolean {
  if (!teamId) return false

  return (
    queryClient
      .getQueryData<AgentConversation[]>(queryKeys.agentSessions(teamId))
      ?.some((row) => row.sessionId === sessionId) ?? false
  )
}
