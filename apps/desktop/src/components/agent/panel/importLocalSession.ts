import { useCallback, useState } from 'react'

import { api } from '../../../api'
import { toast } from '../../ui/toast'

import type { LocalAgentSessionInfo } from '../../../api'
import type { RuntimeInstance } from '../../../types/runtime'

/**
 * Continue a Claude Code / Codex session from this computer on a team agent:
 * the local log's turns become the new conversation's transcript, and the agent
 * picks them up as its own prior context on the first message.
 *
 * Returns undefined when there is nothing to import onto — no workspace, or no
 * agent selected for the next conversation — so the menu can fall back to
 * attaching the log as a file.
 */
export function useLocalSessionImport(args: {
  teamId?: string
  runtime?: RuntimeInstance | null
  openConversation: (sessionId: string, titleHint?: string) => Promise<void>
}): { importSession: ((session: LocalAgentSessionInfo) => void) | undefined; importing: boolean } {
  const { teamId, runtime, openConversation } = args
  const [importing, setImporting] = useState(false)

  const importSession = useCallback(
    (session: LocalAgentSessionInfo) => {
      if (!teamId || !runtime) return
      setImporting(true)
      api
        .agentImportLocalSession({
          source: session.source,
          id: session.id,
          teamId,
          runtimeId: runtime.id,
          agentRuntime: runtime.provider,
        })
        .then(async (result) => {
          toast.success(
            `Imported into ${runtime.label}`,
            result.dropped > 0
              ? `${String(result.messageCount)} messages · ${String(result.dropped)} older turns left out`
              : `${String(result.messageCount)} messages`,
          )
          await openConversation(result.sessionId, result.title)
        })
        .catch((err: unknown) => {
          toast.apiError('Could not import this session', err)
        })
        .finally(() => setImporting(false))
    },
    [openConversation, runtime, teamId],
  )

  return { importSession: teamId && runtime ? importSession : undefined, importing }
}
