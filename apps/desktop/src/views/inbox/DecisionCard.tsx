import clsx from 'clsx'
import { useState } from 'react'

import { api } from '../../api'
import { MessageResponse } from '../../components/agent/MessageResponse'
import { parseSecretRequest } from '../../components/agent/panel/connectCardModel'
import { botChatQuestion } from '../../components/channels/botChatQuestion'
import { BotChatQuestion } from '../../components/channels/BotChatQuestions'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { refreshInputRequests } from '../../lib/inputRequestRefresh'

import { AnswerFailure } from './AnswerFailure'
import { cardReplies } from './inboxItems'
import { useAnswerFailure } from './useInbox'

import type { AgentInputRequest } from '../../api/agent-types'

/**
 * One open question, with what the agent wrote to decide it from. A choice, or
 * "Done." for a to-do, is sent as the reply to this question. A secret is the
 * secure card the conversation and a Bot's chat draw, which sends only where the
 * value was saved. "Other…" types the answer in the conversation's composer,
 * which only comes with the conversation.
 */
export function DecisionCard({
  teamId,
  sessionId,
  title,
  request,
  showingConversation,
  onAnswer,
  onShowConversation,
  onReply,
  onHideConversation,
  onOpenConversation,
}: {
  teamId: string
  sessionId: string
  title: string | undefined
  request: AgentInputRequest
  /** With the transcript shown below, the card takes less of the reader. */
  showingConversation: boolean
  onAnswer: (text: string) => void
  onShowConversation: () => void
  /** Opens the conversation with its composer answering this question. */
  onReply: () => void
  onHideConversation: () => void
  onOpenConversation: () => void
}) {
  // Answers go through the conversation; the card itself only dismisses.
  const [dismissing, setDismissing] = useState(false)
  const replies = cardReplies(request)
  const secret = parseSecretRequest(request) !== null
  const failure = useAnswerFailure(request.id)

  async function dismiss() {
    setDismissing(true)
    try {
      await api.agentResolveDecision(sessionId, request.id, teamId, 'dismissed')
      refreshInputRequests()
    } catch (error) {
      toast.apiError(t('Could not dismiss question'), error)
    } finally {
      setDismissing(false)
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
      {/* A secret's card is its own surface. */}
      <section
        className={clsx(!secret && 'surface-raised rounded-lg bg-surface-raised px-4 py-3.5')}
      >
        {secret ? (
          <BotChatQuestion
            request={{ sessionId, title: title ?? '', inputRequest: request }}
            teamId={teamId}
            onAnswer={onAnswer}
          />
        ) : (
          <>
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
          </>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {replies?.map(({ label, reply }) => (
            <button
              key={label}
              type="button"
              onClick={() => onAnswer(reply)}
              className={primaryButton}
            >
              {label}
            </button>
          ))}
          {!replies && !secret && (
            <button type="button" onClick={onShowConversation} className={primaryButton}>
              {t('Answer in the conversation')}
            </button>
          )}
          {/* A typed answer, in the conversation's composer; a plan is only approved or rejected. */}
          {replies && botChatQuestion(request).typed && (
            <button type="button" onClick={onReply} className={secondaryButton}>
              {request.options?.length ? t('Other…') : t('Reply…')}
            </button>
          )}
          <button
            type="button"
            disabled={dismissing}
            onClick={() => void dismiss()}
            className="ml-auto text-[11px] text-tertiary hover:text-main"
          >
            {dismissing ? t('Dismissing...') : t('Dismiss question')}
          </button>
        </div>
        {/* A secret's card shows its own failure. */}
        {failure && !secret && (
          <div className="mt-3">
            <AnswerFailure message={failure} />
          </div>
        )}
      </section>
    </div>
  )
}

const primaryButton =
  'rounded-md border border-line-control px-3 py-1.5 text-[12px] text-main outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-line-focus disabled:opacity-50'

const secondaryButton =
  'rounded-md px-3 py-1.5 text-[12px] text-secondary outline-none hover:bg-state-hover hover:text-main focus-visible:ring-1 focus-visible:ring-line-focus'
