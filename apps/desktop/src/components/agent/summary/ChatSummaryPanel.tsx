import { clsx } from 'clsx'
import { File, Image as ImageIcon } from 'lucide-react'
import { useRef } from 'react'

import { api } from '../../../api'
import { useAgentRuntimeStates } from '../../../lib/agentRuntimeStates'
import { setChatSummaryOpen, usePresence } from '../../../lib/chatSummaryPanel'
import { requestCredentialPicker } from '../../../lib/credentialPickerEvents'
import { toast } from '../../ui/toast'

import { ChatSummaryEnvironment } from './ChatSummaryEnvironment'
import {
  canPickCredentials,
  changesOf,
  connectorCount,
  deviceLabels,
  splitFileName,
} from './chatSummaryModel'
import { ChangeRow, SummaryLink, SummaryRow, SummarySection, ThreadRow } from './ChatSummaryRows'
import { useChatSummary } from './useChatSummary'

import type { OutputFile } from './chatSummaryModel'
import type { KeyboardEvent } from 'react'

type Props = {
  sessionId: string
  teamId: string
  onOpenLink: (url: string, external: boolean) => void
  onOpenSession: (sessionId: string) => void
}

const PANE = '[data-workspace-focus-surface="session"]'

/** The panel beside the transcript; it stays mounted while it animates out. */
export function ChatSummaryPanel({ open, ...props }: Props & { open: boolean }) {
  const { mounted, leaving } = usePresence(open)

  return mounted ? <SummaryBody {...props} leaving={leaving} /> : null
}

function Skeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      {[88, 52, 140].map((height) => (
        <div
          key={height}
          style={{ height }}
          className="animate-pulse rounded-xl bg-zGray-800/40 motion-reduce:animate-none"
        />
      ))}
    </div>
  )
}

/** Files the agent handed over; a click saves one, as the card in the transcript does. */
function OutputsSection({
  files,
  teamId,
  sessionId,
}: {
  files: OutputFile[]
  teamId: string
  sessionId: string
}) {
  async function download(file: OutputFile) {
    const { groupId, fileId, fileName } = file

    try {
      const saved = await api.fileTransferDownloadOne({
        teamId,
        sessionId,
        groupId,
        fileId,
        fileName,
      })

      if (saved.saved) toast.success('Saved', fileName)
    } catch (error) {
      toast.apiError('Download failed', error)
    }
  }

  return (
    <SummarySection
      title="Outputs"
      rows={files.map((file) => {
        const [name, extension] = splitFileName(file.fileName)

        return (
          <SummaryRow
            key={file.fileId}
            icon={file.image ? <ImageIcon className="size-3.5" /> : <File className="size-3.5" />}
            label={name}
            labelEnd={extension}
            title={`Download ${file.fileName}`}
            onClick={() => void download(file)}
          />
        )
      })}
    />
  )
}

/** Esc inside the panel closes it and hands focus back to the toggle that opened it. */
function closeOnEscape(event: KeyboardEvent, root: HTMLElement | null) {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  event.preventDefault()
  const pane = root?.closest(PANE)

  setChatSummaryOpen(false)
  pane?.querySelector<HTMLElement>('[aria-label="Toggle chat summary"]')?.focus()
}

/** What this chat did and what it runs on. A block appears only when it has something. */
function SummaryBody({
  sessionId,
  teamId,
  onOpenLink,
  onOpenSession,
  leaving,
}: Props & { leaving: boolean }) {
  const rootRef = useRef<HTMLElement>(null)
  const { loaded, conversation, threads, outputs, devices } = useChatSummary(sessionId, teamId)
  const runtimeStates = useAgentRuntimeStates()
  const changes = changesOf(conversation?.linkedResources ?? [])
  const connectors = connectorCount(conversation)
  const canPick = canPickCredentials(conversation)
  const openPicker = (devicesPicker: boolean) => {
    if (rootRef.current) requestCredentialPicker(rootRef.current, devicesPicker)
  }

  return (
    <aside
      ref={rootRef}
      aria-label="Chat summary"
      onKeyDown={(event) => closeOnEscape(event, rootRef.current)}
      className={clsx(
        leaving ? 't-summary-out' : 't-summary-in',
        'absolute inset-y-0 right-0 z-10 flex w-[304px] flex-shrink-0 flex-col gap-3 overflow-y-auto border-l border-zGray-800/60 bg-main px-3.5 py-3 shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)]',
        '@[760px]:static @[760px]:border-l-0 @[760px]:bg-transparent @[760px]:shadow-none',
      )}
    >
      {!loaded && <Skeleton />}
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
      {conversation && (
        <ChatSummaryEnvironment
          conversation={conversation}
          deviceNames={deviceLabels(conversation, devices)}
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
        <OutputsSection files={outputs} teamId={teamId} sessionId={sessionId} />
      )}
      {loaded && !conversation && (
        <div className="px-1 pt-1 text-[13px] leading-5">
          <p className="text-main">Nothing here yet</p>
          <p className="text-tertiary">
            Pull requests, threads and files from this chat appear here after its first reply.
          </p>
        </div>
      )}
    </aside>
  )
}
