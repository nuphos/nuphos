import { clsx } from 'clsx'
import { File, Image as ImageIcon } from 'lucide-react'
import { useRef, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import { useAgentRuntimeStates } from '../../../lib/agentRuntimeStates'
import { setChatSummaryOpen } from '../../../lib/chatSummaryPanel'
import { toast } from '../../ui/toast'

import { ChangesSection } from './ChatSummaryChanges'
import { ChatSummaryEnvironment } from './ChatSummaryEnvironment'
import { changesOf, splitFileName } from './chatSummaryModel'
import { SummaryRow, SummarySection, ThreadRow } from './ChatSummaryRows'
import { SessionInputQueue, SessionInputReply } from './SessionInputQueue'
import { inputRequestKey } from './sessionInputRequests'
import { useChatSummary } from './useChatSummary'

import type { OutputFile } from './chatSummaryModel'
import type { AgentConversation } from '../../../api/agent-types'
import type { KeyboardEvent } from 'react'

type Props = {
  sessionId: string
  teamId: string
  onOpenLink: (url: string, external: boolean) => void
  onOpenSession: (sessionId: string) => void
  requests: AgentConversation[]
  requestsLoaded: boolean
  requestsFailed: boolean
}

const PANE = '[data-workspace-focus-surface="session"]'

/** The panel beside the transcript, mounted only while open. */
export function ChatSummaryPanel({ open, ...props }: Props & { open: boolean }) {
  return open ? <SummaryBody {...props} /> : null
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

      if (saved.saved) toast.success(t('Saved'), fileName)
    } catch (error) {
      toast.apiError(t('Download failed'), error)
    }
  }

  return (
    <SummarySection title={t('Outputs')}>
      {files.map((file) => {
        const [name, extension] = splitFileName(file.fileName)

        return (
          <SummaryRow
            key={file.fileId}
            icon={file.image ? <ImageIcon className="size-3.5" /> : <File className="size-3.5" />}
            label={name}
            labelEnd={extension}
            title={t('Download {name}', { name: file.fileName })}
            onClick={() => void download(file)}
          />
        )
      })}
    </SummarySection>
  )
}

/** Esc inside the panel closes it and hands focus back to the toggle that opened it. */
function closeOnEscape(event: KeyboardEvent, root: HTMLElement | null) {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  event.preventDefault()
  const pane = root?.closest(PANE)

  setChatSummaryOpen(false)
  pane
    ?.querySelector<HTMLElement>(`[aria-label="${CSS.escape(t('Toggle agent summary'))}"]`)
    ?.focus()
}

/** What this chat did and what it runs on. A block appears only when it has something. */
function SummaryBody({
  sessionId,
  teamId,
  onOpenLink,
  onOpenSession,
  requests,
  requestsLoaded,
  requestsFailed,
}: Props) {
  const rootRef = useRef<HTMLElement>(null)
  const [selected, setSelected] = useState<AgentConversation | null>(null)
  const { loaded, conversation, threads, outputs } = useChatSummary(sessionId, teamId)
  const runtimeStates = useAgentRuntimeStates()
  const changes = changesOf(conversation?.linkedResources ?? [])

  return (
    <aside
      ref={rootRef}
      aria-label={t('Agent summary')}
      onKeyDown={(event) => closeOnEscape(event, rootRef.current)}
      className={clsx(
        't-summary-in',
        'absolute inset-y-0 right-0 z-10 flex max-w-full flex-shrink-0 flex-col border-l border-zGray-800/60 bg-main shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)]',
        selected
          ? 'w-[440px] overflow-hidden @[1000px]:static'
          : 'w-[304px] gap-3 overflow-y-auto px-3.5 py-3 @[760px]:static @[760px]:border-l-0 @[760px]:bg-transparent',
        '@[1000px]:shadow-none',
      )}
    >
      {selected ? (
        <SessionInputReply
          key={inputRequestKey(selected)}
          request={selected}
          requests={requests}
          teamId={teamId}
          onSelect={setSelected}
          onBack={() => setSelected(null)}
          onClose={() => setChatSummaryOpen(false)}
          onOpenSession={onOpenSession}
        />
      ) : (
        <>
          <SessionInputQueue
            requests={requests}
            loaded={requestsLoaded}
            failed={requestsFailed}
            onSelect={setSelected}
          />
          {!loaded && <Skeleton />}
          {changes.length > 0 && (
            <ChangesSection sessionId={sessionId} changes={changes} onOpen={onOpenLink} />
          )}
          {threads.length > 0 && (
            <SummarySection title={t('Sub-agents')}>
              {threads.map((thread) => (
                <ThreadRow
                  key={thread.sessionId}
                  conversation={thread}
                  runtimeState={runtimeStates.get(thread.sessionId)}
                  onOpen={onOpenSession}
                />
              ))}
            </SummarySection>
          )}
          {conversation && <ChatSummaryEnvironment conversation={conversation} />}
          {outputs.length > 0 && (
            <OutputsSection files={outputs} teamId={teamId} sessionId={sessionId} />
          )}
          {loaded && !conversation && (
            <div className="px-1 pt-1 text-[13px] leading-5">
              <p className="text-main">{t('Nothing here yet')}</p>
              <p className="text-tertiary">
                {t(
                  'Pull requests, sub-agents and files from this agent appear here after its first reply.',
                )}
              </p>
            </div>
          )}
        </>
      )}
    </aside>
  )
}
