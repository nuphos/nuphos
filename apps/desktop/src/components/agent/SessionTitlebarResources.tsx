import { useEffect, useState } from 'react'

import { agentApi } from '../../api/agent-api'
import { ResourceOpenContext } from '../sidebar/resource-open-context'
import { SessionResources } from '../sidebar/SessionResources'

import type { SessionResource } from '../../api/session-resource-types'

export function SessionTitlebarResources({
  sessionId,
  teamId,
  onOpen,
}: {
  sessionId: string
  teamId: string
  onOpen: (href: string) => boolean
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
    <ResourceOpenContext.Provider
      value={(href) => {
        onOpen(href)
      }}
    >
      <SessionResources titlebar resources={resources} sessionId={sessionId} teamId={teamId} />
    </ResourceOpenContext.Provider>
  )
}
