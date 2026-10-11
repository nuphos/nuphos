import { useEffect, useState } from 'react'

import { agentApi } from '../../api/agent-api'
import { SessionResources } from '../sidebar/SessionResources'

import type { SessionResource } from '../../api/session-resource-types'

export function SessionTitlebarResources({
  sessionId,
  teamId,
  onOpen,
  onOpenTab,
}: {
  sessionId: string
  teamId: string
  onOpen: (url: string, external: boolean) => void
  onOpenTab: (tabId: string) => void
}) {
  const [resources, setResources] = useState<SessionResource[]>([])

  useEffect(() => {
    let disposed = false
    const refresh = () => {
      void agentApi
        .agentGetSessionResources(sessionId, teamId)
        .then((result) => {
          if (!disposed) setResources(result.resources)
        })
        .catch(() => {})
    }

    refresh()
    const timer = window.setInterval(refresh, 5000)

    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [sessionId, teamId])

  return (
    <SessionResources
      titlebar
      resources={resources}
      sessionId={sessionId}
      teamId={teamId}
      onOpen={onOpen}
      onOpenTab={onOpenTab}
    />
  )
}
