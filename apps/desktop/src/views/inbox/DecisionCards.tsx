import clsx from 'clsx'
import { useState } from 'react'

import { api } from '../../api'
import { MessageResponse } from '../../components/agent/MessageResponse'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { refreshInputRequests } from '../../lib/inputRequestRefresh'

import { cardReplies } from './inboxItems'

import type { AgentInputRequest } from '../../api/agent-types'

/**
 * The open questions of one conversation, each with what the agent wrote to
 * decide it from. A choice, or "Done." for a to-do, is sent as the reply to
 * its own question; typing in the composer below answers the selected one.
 */
export function DecisionCards({
  teamId,
  sessionId,
  title,
  requests,
  replyTo,
  showingConversation,
  onChoose,
  onAnswer,
  onShowConversation,
  onHideConversation,
  onOpenConversation,
}: {
  teamId: string
  sessionId: string
  title: string | undefined
  requests: readonly AgentInputRequest[]
  replyTo: string | undefined
  /** With the transcript shown below, the cards take less of the reader. */
  showingConversation: boolean
  onChoose: (requestId: string) => void
  onAnswer: (requestId: string, text: string) => void
  onShowConversation: () => void
  onHideConversation: () => void
  onOpenConversation: () => void
}) {
  // Answers go through the conversation; the card itself only dismisses.
  const [dismissing, setDismissing] = useState<string | null>(null)

  async function dismiss(requestId: string) {
    setDismissing(requestId)
    try {
      await api.agentResolveDecision(sessionId, requestId, teamId, 'dismissed')
      refreshInputRequests()
    } catch (error) {
      toast.apiError(t('Could not dismiss question'), error)
    } finally {
      setDismissing(null)
    }
  }

  return (
    <div
      className={clsx(
        'flex min-h-0 flex-col gap-3 overflow-y-auto px-6 pb-5 pt-4',
        showingConversation ? 'max-h-[45%] shrink-0 border-b border-zGray-800/60' : 'flex-1',
      )}
    >
      <div className="flex items-center gap-2 text-[12px] text-tertiary">
        <span className="min-w-0 flex-1 truncate">{title || t('Untitled agent')}</span>
        <button
          type="button"
          onClick={showingConversation ? onHideConversation : onShowConversation}
          className="shrink-0 hover:text-main"
        >
          {showingConversation ? t('Hide conversation') : t('Show conversation')}
        </button>
        <button type="button" onClick={onOpenConversation} className="shrink-0 hover:text-main">
          {t('Open agent conversation')}
        </button>
      </div>
      {requests.map((request) => {
        const selected = request.id === replyTo
        const replies = cardReplies(request)

        return (
          <section
            key={request.id}
            aria-current={selected}
            onClick={() => onChoose(request.id)}
            className={clsx(
              'rounded-lg border px-4 py-3.5',
              selected ? 'border-zViolet-accent/60 bg-zGray-800/40' : 'border-zGray-800/70',
            )}
          >
            <h2 className="text-[15px] font-medium leading-6 text-main">{request.question}</h2>
            {request.body && (
              <MessageResponse className="mt-2 text-[13px] text-secondary" streaming={false}>
                {request.body}
              </MessageResponse>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {replies ? (
                replies.map(({ label, reply }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onAnswer(request.id, reply)
                    }}
                    className={primaryButton}
                  >
                    {label}
                  </button>
                ))
              ) : (
                <button type="button" onClick={onShowConversation} className={primaryButton}>
                  {t('Answer in the conversation')}
                </button>
              )}
              <button
                type="button"
                disabled={dismissing === request.id}
                onClick={(event) => {
                  event.stopPropagation()
                  void dismiss(request.id)
                }}
                className="ml-auto text-[11px] text-tertiary hover:text-main"
              >
                {dismissing === request.id ? t('Dismissing...') : t('Dismiss question')}
              </button>
            </div>
            {selected && replies && (
              <p className="mt-2 text-[11px] text-tertiary">
                {t('Or type a reply below; it answers this question.')}
              </p>
            )}
          </section>
        )
      })}
    </div>
  )
}

const primaryButton =
  'rounded-md border border-zGray-700 px-3 py-1.5 text-[12px] text-main outline-none hover:bg-zGray-800/70 focus-visible:ring-1 focus-visible:ring-zViolet-accent disabled:opacity-50'
