import clsx from 'clsx'
import { useState } from 'react'

import { api } from '../../api'
import { parseConnectRequest } from '../../components/agent/panel/connectCardModel'
import { CredentialSelectorButton } from '../../components/agent/panel/CredentialSelectorButton'
import { botChatQuestion } from '../../components/channels/botChatQuestion'
import { BotChatQuestion } from '../../components/channels/BotChatQuestions'
import { useBotCredentials } from '../../components/channels/useBotCredentials'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { refreshInputRequests } from '../../lib/inputRequestRefresh'

import { markAsDone } from './inboxItems'

import type { AgentInputRequest } from '../../api/agent-types'

/**
 * One open question, with what the agent wrote to decide it from. A choice, or
 * "Done." for a to-do, is sent as the reply to this question. A secret is the
 * secure card the conversation and a Bot's chat draw, which sends only where the
 * value was saved. An integration is the Connect card, which selects it in the
 * asking conversation's credentials, and that answers it, for whoever may change
 * them. "Other…" types the answer in the conversation's composer, which only
 * comes with the conversation.
 */
export function DecisionCard({
  teamId,
  sessionId,
  title,
  request,
  canManage,
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
  /** Whether the viewer may change the asking conversation's credentials. */
  canManage: boolean
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
  const connect = parseConnectRequest(request) !== null
  const credentials = useBotCredentials(teamId, connect && canManage ? sessionId : undefined)
  // The card a Bot's chat and the transcript draw; what it can't answer is answered in the conversation.
  const { answerable } = botChatQuestion(request, credentials !== undefined)

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
      <section>
        <BotChatQuestion
          request={{ sessionId, title: title ?? '', inputRequest: request }}
          teamId={teamId}
          credentials={credentials}
          onAnswer={onAnswer}
          onReply={onReply}
          fullBody
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {markAsDone(request) && (
            <button type="button" onClick={() => onAnswer('Done.')} className={primaryButton}>
              {t('Mark as done')}
            </button>
          )}
          {/* The conversation's own picker, as its composer has it: a personal
              credential, or one of several, is chosen here. */}
          {credentials && (
            <CredentialSelectorButton {...credentials} hero={false} personalIdentity />
          )}
          {/* Only its owner selects a conversation's credentials; anyone else answers there. */}
          {connect && !canManage && (
            <span className="text-[12px] text-tertiary">
              {t('Only the owner of this conversation can connect this.')}
            </span>
          )}
          {!answerable && (
            <button type="button" onClick={onShowConversation} className={primaryButton}>
              {t('Answer in the conversation')}
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
      </section>
    </div>
  )
}

const primaryButton =
  'rounded-md border border-line-control px-3 py-1.5 text-[12px] text-main outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-line-focus disabled:opacity-50'
