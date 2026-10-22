import { Cloud, Laptop, Monitor, Plug } from 'lucide-react'

import { isLocalAgentRuntime } from '../../../lib/localAgentSharing'

import { connectorCount, deviceCount, machineName } from './chatSummaryModel'
import { SummaryRow, SummarySection } from './ChatSummaryRows'

import type { AgentConversation } from '../../../api/agent-types'

/** Where the chat runs, and how many devices and connectors it may use. */
export function ChatSummaryEnvironment({ conversation }: { conversation: AgentConversation }) {
  const local = isLocalAgentRuntime(conversation.runtimeId)
  const devices = deviceCount(conversation)
  const connectors = connectorCount(conversation)

  return (
    <SummarySection title="Environment">
      <SummaryRow
        icon={local ? <Monitor className="size-3.5" /> : <Cloud className="size-3.5" />}
        label={machineName(conversation.runtimeLabel, local)}
        note={local ? 'Local' : 'Cloud'}
      />
      {devices > 0 && (
        <SummaryRow
          icon={<Laptop className="size-3.5" />}
          label="Computers"
          note={String(devices)}
        />
      )}
      {connectors > 0 && (
        <SummaryRow
          icon={<Plug className="size-3.5" />}
          label="Connectors"
          note={String(connectors)}
        />
      )}
    </SummarySection>
  )
}
