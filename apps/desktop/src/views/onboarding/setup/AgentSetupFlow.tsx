import { useState } from 'react'

import { AGENT_PROVIDER } from '../../../types/runtime'

import { setupStep } from './agentSetup'
import { BoxCloudSetup } from './BoxCloudSetup'
import { CloudAgentStep } from './CloudAgentStep'
import { LocalAgentsStep } from './LocalAgentsStep'
import { SelfHostedSetup } from './SelfHostedSetup'
import { SetupStepper } from './SetupChrome'
import { SetupComplete } from './SetupComplete'

import type { SetupScreen } from './agentSetup'
import type { ConnectedCloudAgent } from './SelfHostedSetup'
import type { AtlasTeam } from '../../../types'

/** Full-window agent setup after creating a workspace: local agents, then an optional cloud agent. */
export function AgentSetupFlow({ team, onFinish }: { team: AtlasTeam; onFinish: () => void }) {
  const [screen, setScreen] = useState<SetupScreen>('local')
  const [boxId, setBoxId] = useState<string | null>(null)
  const [cloudAgent, setCloudAgent] = useState<ConnectedCloudAgent | null>(null)
  const step = setupStep(screen)
  const connected = (agent: ConnectedCloudAgent) => {
    setCloudAgent(agent)
    setScreen('done')
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-y-auto sidebar-surface px-6 pb-10 pt-14 text-main">
      {/* Same surface as the create-workspace step before it, so the window does not change colour. */}
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
      {screen === 'box' && (
        <BoxCloudSetup
          teamId={team.id}
          deviceId={boxId}
          onCreated={setBoxId}
          onBack={() => setScreen('cloud')}
          onConnected={(instance) =>
            connected({
              provider: instance.provider,
              label: AGENT_PROVIDER[instance.provider].label,
            })
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
