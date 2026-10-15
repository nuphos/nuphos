import { useMemo, useState } from 'react'

import { useSwrCache } from '../../../lib/swrCache'
import { agentSessionsCacheKey, sharedSessionsCacheKey } from '../../sidebar/state'
import { useSessionTransferGroups } from '../panel/useTransferDownloads'

import { findConversation, outputFilesOf, subThreadsOf } from './chatSummaryModel'

import type { OutputFile } from './chatSummaryModel'
import type { AgentConversation } from '../../../api/agent-types'

export type ChatSummary = {
  /** False until the sidebar has listed this team's chats once. */
  loaded: boolean
  conversation: AgentConversation | undefined
  threads: AgentConversation[]
  outputs: OutputFile[]
}

/**
 * Reads what the sidebar and the transcript already loaded: the chat lists the
 * sidebar polls, and the download groups the transcript fetched (only for a
 * chat the viewer may list). Nothing here asks the backend.
 */
export function useChatSummary(sessionId: string, teamId: string): ChatSummary {
  const own = useSwrCache<AgentConversation[]>(agentSessionsCacheKey(teamId))
  const shared = useSwrCache<AgentConversation[]>(sharedSessionsCacheKey(teamId))
  const groups = useSessionTransferGroups(sessionId)
  const lists = useMemo(() => [own ?? [], shared ?? []], [own, shared])
  // Expiry is checked against when the panel opened; a group that lapses while
  // it is open still offers its files, and the download says if one is gone.
  const [openedAt] = useState(() => Date.now())

  return {
    loaded: own !== undefined || shared !== undefined,
    conversation: findConversation(sessionId, lists),
    threads: subThreadsOf(sessionId, lists),
    outputs: outputFilesOf(groups, openedAt),
  }
}
