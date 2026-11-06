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
 * its own question; the selected card also takes a short reply typed in its
 * own field. The full composer only comes with the conversation.
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
        showingConversation ? 'max-h-[45%] shrink-0 border-b border-line-control/60' : 'flex-1',
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
              'rounded-lg px-4 py-3.5',
              // The question being answered lifts like the composer; the rest stay on the sheet.
              selected ? 'surface-raised bg-surface-raised' : 'border border-line-control/70',
            )}
          >
            <h2 className="selectable text-[15px] font-medium leading-6 text-main">
              {request.question}
            </h2>
            {request.body && (
              <MessageResponse
                className="selectable mt-2 text-[13px] text-secondary"
                streaming={false}
              >
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
            {selected && replies && <ReplyField onSend={(text) => onAnswer(request.id, text)} />}
          </section>
        )
      })}
    </div>
  )
}

/** A short typed answer for a question none of the choices fits. */
function ReplyField({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('')
  const send = () => {
    const reply = text.trim()

    if (!reply) return
    onSend(reply)
    setText('')
  }

  return (
    <form
      className="mt-3 flex items-center gap-2"
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
      <input
        data-inbox-reply=""
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t('Or type a different answer')}
        aria-label={t('Reply to this question')}
        className="min-w-0 flex-1 rounded-md border border-line-control bg-transparent px-2.5 py-1.5 text-[12px] text-main outline-none placeholder:text-tertiary focus-visible:ring-1 focus-visible:ring-line-focus"
      />
      <button type="submit" disabled={!text.trim()} className={primaryButton}>
        {t('Send')}
      </button>
    </form>
  )
}

const primaryButton =
  'rounded-md border border-line-control px-3 py-1.5 text-[12px] text-main outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-line-focus disabled:opacity-50'
