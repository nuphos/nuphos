import { clsx } from 'clsx'
import { File, Image as ImageIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
import { ChatSummaryEnvironment } from './ChatSummaryEnvironment'
import { changesOf, splitFileName, subAgentsOf } from './chatSummaryModel'
import { SummaryRow, SummarySection } from './ChatSummaryRows'
import { SubAgentsSection } from './ChatSummarySubAgents'
import { ChatSummaryTaskActions } from './ChatSummaryTaskActions'
import { SessionInputQueue, SessionInputReply } from './SessionInputQueue'
import { inputRequestKey } from './sessionInputRequests'
import { PANE, TOGGLE, useDismissOutside, useSummaryPlacement } from './summaryPlacement'
import { useChatSummary } from './useChatSummary'

import type { OutputFile } from './chatSummaryModel'
import type { SessionInputRequest } from './sessionInputRequests'
import type { JournalChatTarget } from '../../../lib/journalEvent'
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

// Matches `.t-summary-slot-out` in index.css.
const CLOSE_MS = 300

/** The panel beside the transcript, mounted while open and while it slides shut. */
export function ChatSummaryPanel({ open, ...props }: Props & { open: boolean }) {
  const [mounted, setMounted] = useState(open)

  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open || !mounted) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(() => setMounted(false), reduced ? 0 : CLOSE_MS)

    return () => window.clearTimeout(timer)
  }, [open, mounted])

  return mounted ? <SummaryBody {...props} closing={!open} /> : null
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

/** Esc inside the panel closes this pane's summary and hands focus back to the toggle that opened it. */
function closeOnEscape(event: KeyboardEvent, root: HTMLElement | null, paneId: string) {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  event.preventDefault()
  setChatSummaryOpen(paneId, false)
  root?.closest(PANE)?.querySelector<HTMLElement>(TOGGLE())?.focus()
}

/** Beside the transcript it is a plain column; floating, a popover like the titlebar menus. */
function panelClass(floating: boolean, closing: boolean, reply: boolean) {
  const content = reply
    ? 'w-[440px] overflow-hidden bg-main'
    : 'w-[304px] gap-3 overflow-y-auto px-3.5 py-3'

  if (!floating)
    return clsx('flex flex-shrink-0 flex-col', content, closing ? 't-summary-out' : 't-summary-in')

  return clsx(
    't-dropdown fixed z-[1000] flex max-w-[calc(100vw-1rem)] flex-col rounded-lg border border-line-control/60 bg-main text-main shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)]',
    content,
    !closing && 'is-open',
  )
}

/** Beside, the slot's width opens and closes with the panel; floating, it takes no room. */
function slotClass(floating: boolean, closing: boolean, reply: boolean) {
  return clsx(
    reply ? '[--summary-width:440px]' : '[--summary-width:304px]',
    floating
      ? 'contents'
      : 'flex w-[var(--summary-width)] flex-shrink-0 justify-end overflow-hidden',
    !floating && (closing ? 't-summary-slot-out' : 't-summary-slot-in'),
  )
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
  closing,
}: Props & { closing: boolean }) {
  const paneId = usePaneId()
  const rootRef = useRef<HTMLElement>(null)
  const frameRef = useRef<HTMLSpanElement>(null)
  const docked = useChatSummaryDocked(paneId)
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
  const background = shellsFromRuntimeState(runtimeStates.get(sessionId))
  const { floating, style } = useSummaryPlacement(frameRef, selected !== null, docked)

  useDismissOutside(rootRef, paneId, floating && !closing)

  const panel = (
    <aside
      ref={rootRef}
      aria-label={t('Agent summary')}
      inert={closing}
      onKeyDown={(event) => closeOnEscape(event, frameRef.current, paneId)}
      style={style}
      data-origin="top-right"
      className={panelClass(floating, closing, selected !== null)}
    >
      {selected ? (
        <SessionInputReply
          key={inputRequestKey(selected)}
          request={selected}
          requests={requests}
          teamId={teamId}
          onSelect={select}
          onBack={() => setSelected(null)}
          onClose={() => setChatSummaryOpen(paneId, false)}
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
          {conversation && <ChatSummaryTaskActions conversation={conversation} teamId={teamId} />}
          {background.length > 0 && <BackgroundTasksSection shells={background} />}
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

  return (
    // Beside the transcript the slot's width grows and shrinks so the transcript
    // reflows with the panel. Floating, the panel is a popover under the
    // titlebar toggle, above the header's fade, so it renders at the root.
    <div className={slotClass(floating, closing, selected !== null)}>
      <span ref={frameRef} aria-hidden className="pointer-events-none absolute inset-0" />
      {floating ? createPortal(panel, document.body) : panel}
    </div>
  )
}
