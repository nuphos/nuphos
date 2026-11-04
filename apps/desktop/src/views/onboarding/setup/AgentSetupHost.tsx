import { useSyncExternalStore } from 'react'

import { AddAgentDialog } from '../../settings/AddAgentDialog'

import { AgentSetupFlow } from './AgentSetupFlow'
import { agentSetup } from './agentSetupStore'

export function AgentSetupHost() {
  const request = useSyncExternalStore(agentSetup.subscribe, agentSetup.current)

  if (request?.kind === 'runtime')
    return <AddAgentDialog teamId={request.teamId} onClose={agentSetup.close} />
  if (!request) return null

  return (
    <>
      {/* Onboarding has nothing behind it; over the workspace its translucent surface needs a floor. */}
      <div className="fixed inset-0 z-40 bg-appBg" aria-hidden="true" />
      <AgentSetupFlow onFinish={agentSetup.close} />
    </>
  )
}
