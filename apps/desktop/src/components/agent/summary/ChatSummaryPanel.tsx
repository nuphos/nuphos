import { Cloud, File, Image as ImageIcon, Laptop, Monitor } from 'lucide-react'
import { useRef } from 'react'

import { api } from '../../../api'
import { useAgentRuntimeStates } from '../../../lib/agentRuntimeStates'
import { requestCredentialPicker } from '../../../lib/credentialPickerEvents'
import { isLocalAgentRuntime } from '../../../lib/localAgentSharing'
import { AGENT_PROVIDER } from '../../../types/runtime'
import { toast } from '../../ui/toast'
import { AgentProviderIcon } from '../panel/icons'

import { changesOf, connectorCount, deviceLabels } from './chatSummaryModel'
import { ChangeRow, SummaryLink, SummaryRow, SummarySection, ThreadRow } from './ChatSummaryRows'
import { useChatSummary } from './useChatSummary'

import type { OutputFile } from './chatSummaryModel'
import type { AgentConversation } from '../../../api/agent-types'

/** "MacBook-Pro.local · Claude Code" names the agent too; its own row shows that. */
function runtimeName(label: string | undefined, local: boolean): string {
  const name = label?.split(' · ')[0]?.trim()

  if (name) return name

  return local ? 'This computer' : 'Cloud runtime'
}

/** Where the chat runs: its runtime, its agent, and the devices it may use. */
function EnvironmentSection({
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

  return (
    <SummarySection
      title="Environment"
      rows={[
        <SummaryRow
          key="runtime"
          icon={local ? <Monitor className="size-3.5" /> : <Cloud className="size-3.5" />}
          label={runtimeName(conversation.runtimeLabel, local)}
          note={local ? 'Local' : 'Cloud'}
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
        ...deviceNames.map((name) => (
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

/**
 * What this chat did and what it runs on, beside the transcript. Every block
 * appears only when the chat has something to put in it.
 */
export function ChatSummaryPanel({
  sessionId,
  teamId,
  onOpenLink,
  onOpenSession,
}: {
  sessionId: string
  teamId: string
  onOpenLink: (url: string, external: boolean) => void
  onOpenSession: (sessionId: string) => void
}) {
  const rootRef = useRef<HTMLElement>(null)
  const { conversation, threads, outputs, devices } = useChatSummary(sessionId, teamId)
  const runtimeStates = useAgentRuntimeStates()
  const changes = changesOf(conversation?.linkedResources ?? [])
  const connectors = connectorCount(conversation)
  const deviceNames = deviceLabels(conversation, devices)
  // The picker lives in the composer, which only a chat's managers see.
  const canPick = conversation?.canManage !== false && conversation?.readOnly !== true
  const openPicker = (pickDevices: boolean) => {
    if (rootRef.current) requestCredentialPicker(rootRef.current, pickDevices)
  }

  async function download(file: OutputFile) {
    try {
      const saved = await api.fileTransferDownloadOne({
        teamId,
        sessionId,
        groupId: file.groupId,
        fileId: file.fileId,
        fileName: file.fileName,
      })

      if (saved.saved) toast.success('Saved', file.fileName)
    } catch (error) {
      toast.apiError('Download failed', error)
    }
  }

  return (
    <aside
      ref={rootRef}
      aria-label="Chat summary"
      className="t-share-in absolute inset-y-0 right-0 z-10 flex w-[304px] flex-shrink-0 flex-col gap-3 overflow-y-auto border-l border-zGray-800/60 bg-main px-3.5 py-3 shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)] @[760px]:static @[760px]:border-l-0 @[760px]:bg-transparent @[760px]:shadow-none"
    >
      {conversation && (
        <EnvironmentSection
          conversation={conversation}
          deviceNames={deviceNames}
          onPickDevices={canPick ? () => openPicker(true) : undefined}
        />
      )}
      {connectors > 0 && (
        <SummaryLink
          title="Connectors"
          value={`${String(connectors)} connected`}
          onClick={canPick ? () => openPicker(false) : undefined}
        />
      )}
      {outputs.length > 0 && (
        <SummarySection
          title="Outputs"
          rows={outputs.map((file) => (
            <SummaryRow
              key={file.fileId}
              icon={file.image ? <ImageIcon className="size-3.5" /> : <File className="size-3.5" />}
              label={file.fileName}
              title={`Download ${file.fileName}`}
              onClick={() => void download(file)}
            />
          ))}
        />
      )}
      {changes.length > 0 && (
        <SummarySection
          title="Changes"
          rows={changes.map((resource) => (
            <ChangeRow key={resource.id} resource={resource} onOpen={onOpenLink} />
          ))}
        />
      )}
      {threads.length > 0 && (
        <SummarySection
          title="Threads"
          rows={threads.map((thread) => (
            <ThreadRow
              key={thread.sessionId}
              conversation={thread}
              runtimeState={runtimeStates.get(thread.sessionId)}
              onOpen={onOpenSession}
            />
          ))}
        />
      )}
      {!conversation && (
        <p className="px-1 text-[13px] text-tertiary">
          Nothing to show yet. Details appear after the first reply.
        </p>
      )}
    </aside>
  )
}
