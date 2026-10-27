import { ArrowLeft, ArrowUpRight, MessageCircleQuestion, X } from 'lucide-react'
import { useState } from 'react'

import { AgentPanel } from '../AgentPanel'

import { SummarySection } from './ChatSummaryRows'
import { inputRequestKey } from './sessionInputRequests'

import type { AgentConversation } from '../../../api/agent-types'

export function SessionInputQueue({
  requests,
  failed,
  loaded,
  onSelect,
}: {
  requests: AgentConversation[]
  failed: boolean
  loaded: boolean
  onSelect: (request: AgentConversation) => void
}) {
  const title = requests.length
    ? `Needs your input · ${String(requests.length)}`
    : 'Needs your input'

  return (
    <SummarySection title={title}>
      {!loaded && !failed && requests.length === 0 && (
        <p className="py-1 text-[12px] text-tertiary">Checking for questions...</p>
      )}
      {loaded && requests.length === 0 && (
        <p className="py-1 text-[12px] text-tertiary">No questions waiting for you.</p>
      )}
      {failed && (
        <p role="status" className="py-1 text-[12px] text-warning">
          Could not refresh questions. Retrying automatically.
        </p>
      )}
      {requests.map((request) => (
        <button
          key={inputRequestKey(request)}
          type="button"
          onClick={() => onSelect(request)}
          className="-mx-1.5 flex items-start gap-2.5 rounded-md px-1.5 py-2 text-left outline-none hover:bg-zGray-800/50 focus-visible:ring-1 focus-visible:ring-zViolet-accent"
        >
          <MessageCircleQuestion aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-main">
              {request.title || 'Untitled agent'}
            </span>
            <span className="mt-0.5 line-clamp-2 block text-[12px] leading-5 text-secondary">
              {request.pendingDecision?.question}
            </span>
          </span>
        </button>
      ))}
    </SummarySection>
  )
}

/** Keeps the chosen agent open while its answer runs; new arrivals never change the selection. */
export function SessionInputReply({
  request,
  requests,
  teamId,
  onSelect,
  onBack,
  onClose,
  onOpenSession,
}: {
  request: AgentConversation
  requests: AgentConversation[]
  teamId: string
  onSelect: (request: AgentConversation) => void
  onBack: () => void
  onClose: () => void
  onOpenSession: (sessionId: string) => void
}) {
  const stillPending = requests.some((item) => inputRequestKey(item) === inputRequestKey(request))
  const next = requests.find((item) => inputRequestKey(item) !== inputRequestKey(request))
  const [locate, setLocate] = useState(
    request.pendingDecision
      ? { sessionId: request.sessionId, target: { toolCallId: request.pendingDecision.toolCallId } }
      : null,
  )

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-zGray-800/60 px-3 py-2.5">
        <button
          type="button"
          aria-label="Back to pending questions"
          onClick={onBack}
          className="rounded p-1 text-secondary hover:text-main"
        >
          <ArrowLeft aria-hidden className="size-4" />
        </button>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-main">
          Reply to {request.title || 'agent'}
        </span>
        <button
          type="button"
          aria-label="Open agent conversation"
          onClick={() => onOpenSession(request.sessionId)}
          className="rounded p-1 text-secondary hover:text-main"
        >
          <ArrowUpRight aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Close pending questions"
          onClick={onClose}
          className="rounded p-1 text-secondary hover:text-main"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <div className="shrink-0 border-b border-zGray-800/60 px-4 py-3">
        <p className="text-[12px] leading-5 text-main">{request.pendingDecision?.question}</p>
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-tertiary">
          <span role="status">
            {stillPending
              ? 'Your reply goes to this agent only.'
              : 'This request is no longer pending.'}
          </span>
          {next && (
            <button
              type="button"
              onClick={() => onSelect(next)}
              className="shrink-0 text-zViolet-accent"
            >
              Next question →
            </button>
          )}
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        <AgentPanel
          variant="page"
          open
          teamId={teamId}
          sessionId={request.sessionId}
          sessionReadOnly={(request.readOnly ?? false) || !stillPending}
          composerDraftId={`input:${inputRequestKey(request)}`}
          focusComposerOnOpen={false}
          pendingLocate={locate}
          onLocateConsumed={() => setLocate(null)}
        />
      </div>
    </>
  )
}
