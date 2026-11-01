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
import { changesOf, splitFileName, subAgentsOf } from './chatSummaryModel'
import { SummaryRow, SummarySection } from './ChatSummaryRows'
import { SubAgentsSection } from './ChatSummarySubAgents'
import { SessionInputQueue, SessionInputReply } from './SessionInputQueue'
import { inputRequestKey } from './sessionInputRequests'
import { useChatSummary } from './useChatSummary'

import type { OutputFile } from './chatSummaryModel'
import type { JournalChatTarget } from '../../../lib/journalEvent'
import type { SessionInputRequest } from './sessionInputRequests'
import type { KeyboardEvent } from 'react'

type Props = {
  sessionId: string
  teamId: string
  onOpenLink: (url: string, external: boolean) => void
  onOpenSession: (sessionId: string) => void
  /** Opens the conversation in the main pane at the message asking this question. */
  onOpenRequest: (sessionId: string, target?: JournalChatTarget) => void
  /** Points the main composer's reply at one of this conversation's own questions. */
  onChooseReply?: (requestId: string) => void
  requests: SessionInputRequest[]
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
  onOpenRequest,
  onChooseReply,
  requests,
  requestsLoaded,
  requestsFailed,
}: Props) {
  const rootRef = useRef<HTMLElement>(null)
  const [selected, setSelected] = useState<SessionInputRequest | null>(null)
  // A question this conversation asked is answered in its own chat: a second copy
  // of the same transcript beside it would only repeat it.
  const select = (request: SessionInputRequest) => {
    if (request.sessionId === sessionId) {
      const { id, question, options } = request.inputRequest

      setSelected(null)
      onChooseReply?.(id)
      onOpenRequest(sessionId, { toolCallId: id, question, options })
    } else {
      setSelected(request)
    }
  }
  const { loaded, conversation, threads, outputs } = useChatSummary(sessionId, teamId)
  // The lists that listed these threads published their states to the shared store.
  const runtimeStates = useAgentRuntimeStates()
  const subAgents = subAgentsOf(threads, runtimeStates)
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
          onSelect={select}
          onBack={() => setSelected(null)}
          onClose={() => setChatSummaryOpen(false)}
          onOpenSession={onOpenRequest}
        />
      ) : (
        <>
          <SessionInputQueue
            requests={requests}
            loaded={requestsLoaded}
            failed={requestsFailed}
            onSelect={select}
          />
          {!loaded && <Skeleton />}
          {changes.length > 0 && (
            <ChangesSection sessionId={sessionId} changes={changes} onOpen={onOpenLink} />
          )}
          {subAgents.length > 0 && (
            <SubAgentsSection sessionId={sessionId} subAgents={subAgents} onOpen={onOpenSession} />
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
