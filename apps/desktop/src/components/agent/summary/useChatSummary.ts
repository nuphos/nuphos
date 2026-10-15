import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { agentApi } from '../../../api/agent-api'
import { readSwrCache } from '../../../lib/swrCache'
import { agentSessionsCacheKey, sharedSessionsCacheKey } from '../../sidebar/state'

import { findConversation, outputFilesOf, subThreadsOf } from './chatSummaryModel'

import type { OutputFile } from './chatSummaryModel'
import type { AgentCredentialOptions } from '../../../api/agent-credential-types'
import type { AgentConversation } from '../../../api/agent-types'

// The sidebar refreshes both chat lists every few seconds; the panel reads its
// copies instead of asking the backend again.
const LIST_READ_MS = 2_000

type Lists = { loaded: boolean; lists: AgentConversation[][] }

function readLists(teamId: string): Lists {
  const own = readSwrCache<AgentConversation[]>(agentSessionsCacheKey(teamId))
  const shared = readSwrCache<AgentConversation[]>(sharedSessionsCacheKey(teamId))

  return { loaded: own !== undefined || shared !== undefined, lists: [own ?? [], shared ?? []] }
}

export type ChatSummary = {
  /** False until the sidebar has listed this team's chats once. */
  loaded: boolean
  conversation: AgentConversation | undefined
  threads: AgentConversation[]
  outputs: OutputFile[]
  devices: AgentCredentialOptions['devices'] | undefined
}

/** Read only while the panel is mounted, which is while it is open. */
export function useChatSummary(sessionId: string, teamId: string): ChatSummary {
  const [{ loaded, lists }, setLists] = useState(() => readLists(teamId))
  const [outputs, setOutputs] = useState<{ sessionId: string; files: OutputFile[] } | null>(null)
  const [devices, setDevices] = useState<AgentCredentialOptions['devices']>()

  useEffect(() => {
    const timer = window.setInterval(() => setLists(readLists(teamId)), LIST_READ_MS)

    return () => window.clearInterval(timer)
  }, [teamId])

  const conversation = findConversation(sessionId, lists)
  const lastActiveAt = conversation?.lastActiveAt

  // Files land during a turn, so read the store again whenever the chat moves on.
  useEffect(() => {
    let cancelled = false

    void api
      .fileTransferListDownloads({ teamId, sessionId })
      .then((result) => {
        if (!cancelled) setOutputs({ sessionId, files: outputFilesOf(result.groups, Date.now()) })
      })
      // Only the owner may list them; a teammate's panel simply has no Outputs.
      .catch(() => {
        if (!cancelled) setOutputs({ sessionId, files: [] })
      })

    return () => {
      cancelled = true
    }
  }, [teamId, sessionId, lastActiveAt])

  const deviceCount = conversation?.credentialAccess?.deviceIds.length ?? 0

  useEffect(() => {
    if (!deviceCount) return
    let cancelled = false

    void agentApi
      .agentGetCredentialOptions(teamId)
      .then((options) => {
        if (!cancelled) setDevices(options.devices)
      })
      .catch(() => {
        if (!cancelled) setDevices([])
      })

    return () => {
      cancelled = true
    }
  }, [teamId, deviceCount])

  return {
    loaded,
    conversation,
    threads: subThreadsOf(sessionId, lists),
    outputs: outputs?.sessionId === sessionId ? outputs.files : [],
    devices,
  }
}
