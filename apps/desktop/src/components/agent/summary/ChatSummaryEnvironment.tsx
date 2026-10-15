import { Cloud, Laptop, Monitor } from 'lucide-react'

import { isLocalAgentRuntime } from '../../../lib/localAgentSharing'
import { AGENT_PROVIDER } from '../../../types/runtime'
import { AgentProviderIcon } from '../panel/icons'

import { machineName, otherDevices } from './chatSummaryModel'
import { SummaryRow, SummarySection } from './ChatSummaryRows'

import type { AgentConversation } from '../../../api/agent-types'

/** Where the chat runs: its machine, its agent, and any other devices it may use. */
export function ChatSummaryEnvironment({
  conversation,
  deviceNames,
  onPickDevices,
}: {
  conversation: AgentConversation
  deviceNames: string[]
  onPickDevices: (() => void) | undefined
}) {
  const provider = conversation.agentRuntime
  const local = isLocalAgentRuntime(conversation.runtimeId)
  const machine = machineName(conversation.runtimeLabel, local)
  // The machine running a local chat is usually also its one device: one row for both.
  const { others, machineIsDevice } = otherDevices(deviceNames, machine)
  const pickHere = machineIsDevice ? onPickDevices : undefined

  return (
    <SummarySection
      title="Environment"
      rows={[
        <SummaryRow
          key="runtime"
          icon={local ? <Monitor className="size-3.5" /> : <Cloud className="size-3.5" />}
          label={machine}
          note={local ? 'Local' : 'Cloud'}
          title={pickHere ? 'Choose devices' : machine}
          onClick={pickHere}
        />,
        ...(provider
          ? [
              <SummaryRow
                key="agent"
                icon={<AgentProviderIcon provider={provider} className="size-3.5" />}
                label={AGENT_PROVIDER[provider].label}
              />,
            ]
          : []),
        ...others.map((name) => (
          <SummaryRow
            key={`device-${name}`}
            icon={<Laptop className="size-3.5" />}
            label={name}
            note="Device"
            title={onPickDevices ? 'Choose devices' : name}
            onClick={onPickDevices}
          />
        )),
      ]}
    />
  )
}
