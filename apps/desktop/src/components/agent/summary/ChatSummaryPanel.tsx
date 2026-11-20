import { File, Image as ImageIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { api } from '../../../api'
import { usePaneId } from '../../../app/workspace/WorkspacePaneContext'
import { t } from '../../../i18n'
import { useAgentRuntimeStates } from '../../../lib/agentRuntimeStates'
import { setChatSummaryOpen, useChatSummaryDocked } from '../../../lib/chatSummaryPanel'
import { toast } from '../../ui/toast'
import { shellsFromRuntimeState } from '../panel/shells'

import { BackgroundTasksSection } from './ChatSummaryBackgroundTasks'
import { ChangesSection } from './ChatSummaryChanges'
import { changesOf, splitFileName, subAgentsOf } from './chatSummaryModel'
import { SummaryRow, SummarySection } from './ChatSummaryRows'
import { SubAgentsSection } from './ChatSummarySubAgents'
import { ChatSummaryTaskActions } from './ChatSummaryTaskActions'
import { summaryTriggerHome } from './chatSummaryTriggerHome'
import { ChatSummaryTriggers } from './ChatSummaryTriggers'
import { SessionInputQueue, SessionInputReply } from './SessionInputQueue'
import { inputRequestKey } from './sessionInputRequests'
import {
  PANE,
  TOGGLE,
  panelClass,
  slotClass,
  useDismissOutside,
  useSummaryMotion,
  useSummaryPlacement,
} from './summaryPlacement'
import { useChatSummary } from './useChatSummary'

import type { OutputFile } from './chatSummaryModel'
import type { SessionInputRequest } from './sessionInputRequests'
import type { Motion } from './summaryPlacement'
import type { AgentConversation } from '../../../api/agent-types'
import type { JournalChatTarget } from '../../../lib/journalEvent'
import type { KeyboardEvent, ReactNode } from 'react'

type Props = {
  sessionId: string
  teamId: string
  onOpenLink: (url: string, external: boolean) => void
  onOpenSession: (sessionId: string) => void
  /** Opens the conversation in the main pane at the message asking this question. */
  onOpenRequest: (sessionId: string, target?: JournalChatTarget) => void
  /** Where a question under "Needs your input" opens instead: a Bot's details send it to the Inbox. */
  onSelectRequest?: (request: SessionInputRequest) => void
  requests: SessionInputRequest[]
  requestsLoaded: boolean
  requestsFailed: boolean
  /** Drawn first, above everything the chat did: a Bot chat's card of the Bot. With it, no Changes. */
  lead?: ReactNode
  /** Drawn after a Bot's instructions: what the Bot may use. */
  access?: ReactNode
  onEditTrigger?: (message: string) => void // seeds the composer: a Trigger row's Edit
  /** The panel's accessible name; by default "Task summary". */
  label?: string
  /** Closes the panel; by default this pane's Task summary. */
  onClose?: () => void
  /** What a press outside the floating panel does; by default onClose. */
  onDismiss?: () => void
}

/** The panel beside the transcript, mounted while open and while it slides shut. */
export function ChatSummaryPanel({
  open,
  onClose,
  onDismiss,
  ...props
}: Props & { open: boolean }) {
  const paneId = usePaneId()
  const { mounted, motion } = useSummaryMotion(open)

  const close = onClose ?? (() => setChatSummaryOpen(paneId, false))

  return mounted ? (
    <SummaryBody {...props} onClose={close} onDismiss={onDismiss ?? close} motion={motion} />
  ) : null
}

function Skeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      {[88, 52, 140].map((height) => (
        <div
          key={height}
          style={{ height }}
          className="animate-pulse rounded-xl bg-state-selected motion-reduce:animate-none"
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

/** A Bot's standing instructions in full, which its transcript only shows clipped. */
function BotInstructionsSection({ conversation }: { conversation?: AgentConversation }) {
  if (!conversation?.avatar) return null

  return (
    <SummarySection title={t('Bot instructions')}>
      <p className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-5 text-main">
        {conversation.instructions || <span className="text-tertiary">{t('None yet')}</span>}
      </p>
    </SummarySection>
  )
}

/**
 * Esc inside the panel closes it and hands focus back to the toggle that opened it. A dialog it
 * opened sits in a portal: its Esc bubbles here through React, but closes only the dialog.
 */
function closeOnEscape(event: KeyboardEvent, root: HTMLElement | null, close: () => void) {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  if (!event.currentTarget.contains(event.target as Node)) return
  event.preventDefault()
  close()
  root?.closest(PANE)?.querySelector<HTMLElement>(TOGGLE)?.focus()
}

/** What this chat did and what it runs on. A block appears only when it has something. */
function SummaryBody({
  sessionId,
  teamId,
  onOpenLink,
  onOpenSession,
  onOpenRequest,
  onSelectRequest,
  requests,
  requestsLoaded,
  requestsFailed,
  lead,
  access,
  onEditTrigger,
  label,
  onClose: close,
  onDismiss: dismiss,
  motion,
}: Props & { onClose: () => void; onDismiss: () => void; motion: Motion }) {
  const closing = motion === 'out'
  const paneId = usePaneId()
  const rootRef = useRef<HTMLElement>(null)
  const frameRef = useRef<HTMLSpanElement>(null)
  const docked = useChatSummaryDocked(paneId)
  const [selected, setSelected] = useState<SessionInputRequest | null>(null)
  // Its own question is answered in its own chat, not in a second copy beside it.
  const select = (request: SessionInputRequest) => {
    if (onSelectRequest) return onSelectRequest(request)
    if (request.sessionId !== sessionId) return setSelected(request)
    const { id, question, options } = request.inputRequest

    setSelected(null)
    onOpenRequest(sessionId, { toolCallId: id, question, options })
  }
  const { loaded, conversation, threads, outputs } = useChatSummary(sessionId, teamId)
  // The lists that listed these threads published their states to the shared store.
  const runtimeStates = useAgentRuntimeStates()
  const subAgents = subAgentsOf(threads, runtimeStates)
  const triggerHome = summaryTriggerHome(sessionId, conversation)
  const changes = changesOf(conversation?.linkedResources ?? [])
  const background = shellsFromRuntimeState(runtimeStates.get(sessionId))
  const { floating, style } = useSummaryPlacement(frameRef, selected !== null, docked)

  useDismissOutside(rootRef, dismiss, floating && !closing)

  const panel = (
    <aside
      ref={rootRef}
      aria-label={label ?? t('Task summary')}
      inert={closing}
      onKeyDown={(event) => closeOnEscape(event, frameRef.current, close)}
      style={style}
      data-origin="top-right"
      className={panelClass(floating, motion, selected !== null)}
    >
      {selected ? (
        <SessionInputReply
          key={inputRequestKey(selected)}
          request={selected}
          requests={requests}
          teamId={teamId}
          onSelect={select}
          onBack={() => setSelected(null)}
          onClose={close}
          onOpenSession={onOpenRequest}
        />
      ) : (
        <>
          {lead}
          <SessionInputQueue
            requests={requests}
            loaded={requestsLoaded}
            failed={requestsFailed}
            onSelect={select}
          />
          {conversation && <ChatSummaryTaskActions conversation={conversation} teamId={teamId} />}
          <BotInstructionsSection conversation={conversation} />
          {access}
          {background.length > 0 && <BackgroundTasksSection shells={background} />}
          <ChatSummaryTriggers
            key={`${teamId}:${triggerHome}`}
            teamId={teamId}
            sessionId={triggerHome}
            onEdit={onEditTrigger}
          />
          {!loaded && <Skeleton />}
          {/* A Bot's details leave out a Task's pull requests and issues. */}
          {changes.length > 0 && !lead && (
            <ChangesSection sessionId={sessionId} changes={changes} onOpen={onOpenLink} />
          )}
          {subAgents.length > 0 && (
            <SubAgentsSection subAgents={subAgents} onOpen={onOpenSession} />
          )}
          {outputs.length > 0 && (
            <OutputsSection files={outputs} teamId={teamId} sessionId={sessionId} />
          )}
          {/* A Task's first reply fills it; a Bot's card already stands in. */}
          {loaded && !conversation && !lead && (
            <div className="px-1 pt-1 text-[13px] leading-5">
              <p className="text-main">{t('Nothing here yet')}</p>
              <p className="text-tertiary">
                {t(
                  'Pull requests, sub-tasks and files from this task appear here after its first reply.',
                )}
              </p>
            </div>
          )}
        </>
      )}
    </aside>
  )

  return (
    // Beside the transcript the slot's width grows and shrinks so the transcript
    // reflows with the panel. Floating, the panel is a popover under the
    // titlebar toggle, above the header's fade, so it renders at the root.
    <div className={slotClass(floating, motion, selected !== null)}>
      <span ref={frameRef} aria-hidden className="pointer-events-none absolute inset-0" />
      {floating ? createPortal(panel, document.body) : panel}
    </div>
  )
}
