import { ClaudeIcon, CodexIcon, AgentProviderIcon } from '../../../components/agent/panel/icons'
import { Button } from '../../../components/ui/button'
import { useLocalRuntimeState } from '../../../hooks/useLocalRuntimeState'
import { AGENT_PROVIDER } from '../../../types/runtime'

import { LOCAL_AGENT_INFO, readyLocalAgents } from './agentSetup'
import { SetupScreen, StatusPill } from './SetupChrome'

import type { ConnectedCloudAgent } from './SelfHostedSetup'
import type { ReactNode } from 'react'

function AgentRow({
  icon,
  name,
  where,
  status,
}: {
  icon: ReactNode
  name: string
  where: string
  status: 'ready' | 'connected'
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-zGray-800 bg-zGray-900 px-4 py-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zGray-800 text-main">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-main">{name}</p>
        <p className="text-[12px] text-tertiary">{where}</p>
      </div>
      <StatusPill status={status} />
    </li>
  )
}

/** What this flow set up, before landing in the app. */
export function SetupComplete({
  cloudAgent,
  onFinish,
}: {
  cloudAgent: ConnectedCloudAgent | null
  onFinish: () => void
}) {
  const local = readyLocalAgents(useLocalRuntimeState())
  const empty = local.length === 0 && !cloudAgent

  return (
    <SetupScreen
      title="You’re all set"
      subtitle={
        empty
          ? 'You can add agents any time from Settings › Agents.'
          : 'These agents are ready for your conversations.'
      }
      actions={<Button onClick={onFinish}>Start using Nuphos</Button>}
    >
      {!empty && (
        <ul className="space-y-3">
          {local.map((provider) => {
            const Icon = provider === 'codex' ? CodexIcon : ClaudeIcon

            return (
              <AgentRow
                key={provider}
                icon={<Icon className="h-5 w-5" />}
                name={LOCAL_AGENT_INFO[provider].name}
                where="On this computer"
                status="ready"
              />
            )
          })}
          {cloudAgent && (
            <AgentRow
              icon={<AgentProviderIcon provider={cloudAgent.provider} className="h-5 w-5" />}
              name={cloudAgent.label}
              where={`${AGENT_PROVIDER[cloudAgent.provider].label} in the cloud`}
              status="connected"
            />
          )}
        </ul>
      )}
    </SetupScreen>
  )
}
