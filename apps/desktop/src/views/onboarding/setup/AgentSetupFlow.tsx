import { useState } from 'react'

import { api } from '../../../api'
import { toast } from '../../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../../hooks/useRuntimeInstances'

import { setupStep, unsignedAgentToRemove } from './agentSetup'
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
  const [leaving, setLeaving] = useState(false)
  const step = setupStep(screen)
  const connected = (agent: ConnectedCloudAgent) => {
    setCloudAgent(agent)
    setScreen('done')
  }

  // Skipping or switching to Self-hosted must not leave an unsigned Nuphos Cloud agent running.
  async function leaveCloudStep(next: 'managed' | 'self-hosted' | 'skip') {
    const orphan = unsignedAgentToRemove(managed, next)

    if (orphan) {
      setLeaving(true)
      try {
        await api.atlasRemoveRuntimeInstance(team.id, orphan.id)
        setManaged(null)
        window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
      } catch (error) {
        toast.apiError('Could not remove the unfinished agent', error)

        return
      } finally {
        setLeaving(false)
      }
    }
    if (next === 'skip') onFinish()
    else setScreen(next)
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
          busy={leaving}
          onSkip={() => void leaveCloudStep('skip')}
          onChoose={(choice) => void leaveCloudStep(choice)}
        />
      )}
      {screen === 'managed' && (
        <ManagedCloudSetup
          teamId={team.id}
          created={managed}
          onCreatedChange={setManaged}
          onBack={() => setScreen('cloud')}
          onConnected={(instance) => {
            // Signed in: it is the workspace's agent now, never an orphan to remove.
            setManaged(null)
            connected({ provider: instance.provider, label: instance.label })
          }}
        />
      )}
      {screen === 'self-hosted' && (
        <SelfHostedSetup team={team} onBack={() => setScreen('cloud')} onConnected={connected} />
      )}
      {screen === 'done' && <SetupComplete cloudAgent={cloudAgent} onFinish={onFinish} />}
    </div>
  )
}
