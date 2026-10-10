import { useState } from 'react'

import { setupStep } from './agentSetup'
import { CloudAgentStep } from './CloudAgentStep'
import { LocalAgentsStep } from './LocalAgentsStep'
import { ManagedCloudSetup } from './ManagedCloudSetup'
import { SelfHostedSetup } from './SelfHostedSetup'
import { SetupStepper } from './SetupChrome'
import { SetupComplete } from './SetupComplete'

import type { SetupScreen } from './agentSetup'
import type { ConnectedCloudAgent } from './SelfHostedSetup'
import type { AtlasTeam } from '../../../types'
import type { RuntimeInstance } from '../../../types/runtime'

/** Full-window agent setup after creating a workspace: local agents, then an optional cloud agent. */
export function AgentSetupFlow({ team, onFinish }: { team: AtlasTeam; onFinish: () => void }) {
  const [screen, setScreen] = useState<SetupScreen>('local')
  const [managed, setManaged] = useState<RuntimeInstance | null>(null)
  const [cloudAgent, setCloudAgent] = useState<ConnectedCloudAgent | null>(null)
  const step = setupStep(screen)
  const connected = (agent: ConnectedCloudAgent) => {
    setCloudAgent(agent)
    setScreen('done')
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-main px-6 pb-10 pt-14 text-main">
      {/* Only the top strip drags the window, so portaled dialogs keep their clicks. */}
      <div className="titlebar-drag absolute inset-x-0 top-0 h-11" aria-hidden="true" />
      {step && (
        <div className="mb-10">
          <SetupStepper step={step} />
        </div>
      )}
      {screen === 'local' && <LocalAgentsStep onContinue={() => setScreen('cloud')} />}
      {screen === 'cloud' && (
        <CloudAgentStep
          isAdmin={team.role === 'ADMINISTRATOR'}
          onSkip={onFinish}
          onChoose={setScreen}
        />
      )}
      {screen === 'managed' && (
        <ManagedCloudSetup
          teamId={team.id}
          created={managed}
          onCreatedChange={setManaged}
          onBack={() => setScreen('cloud')}
          onConnected={(instance) =>
            connected({ provider: instance.provider, label: instance.label })
          }
        />
      )}
      {screen === 'self-hosted' && (
        <SelfHostedSetup team={team} onBack={() => setScreen('cloud')} onConnected={connected} />
      )}
      {screen === 'done' && <SetupComplete cloudAgent={cloudAgent} onFinish={onFinish} />}
    </div>
  )
}
