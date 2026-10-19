import { useCallback, useState } from 'react'

import type { AgentProvider } from '../../types/runtime'

export type SessionHeading = {
  sessionId: string | null
  title: string
  canRename?: boolean
  canArchive?: boolean
  saved?: boolean
  watching?: boolean
  runtime: AgentProvider | null
  runtimeId?: string
}

// The titlebar heading AgentPanel reports for the open chat. A heading left
// over from another session falls back to the default until the panel reports.
export function useSessionHeading(selectedSessionId: string | null) {
  const [heading, setHeading] = useState<SessionHeading>({
    sessionId: null,
    title: 'Agent',
    runtime: null,
  })
  const handleTitleChange = useCallback(
    (
      nextTitle: string,
      sessionId: string | null,
      runtimeAttached: boolean,
      agentRuntime?: AgentProvider,
      canRename?: boolean,
      runtimeId?: string,
      canArchive?: boolean,
      saved?: boolean,
      watching?: boolean,
    ) => {
      setHeading({
        sessionId,
        canRename,
        canArchive,
        saved,
        watching,
        runtimeId,
        title: nextTitle || 'Agent',
        runtime: runtimeAttached ? (agentRuntime ?? 'claude-code') : null,
      })
    },
    [],
  )
  const currentHeading: SessionHeading =
    heading.sessionId === selectedSessionId
      ? heading
      : { sessionId: selectedSessionId, title: 'Agent', runtime: null }

  return { currentHeading, handleTitleChange }
}
