import { parseConnectRequest } from '../../components/agent/panel/connectCardModel'
import { CredentialSelectorButton } from '../../components/agent/panel/CredentialSelectorButton'
import { BotChatQuestion } from '../../components/channels/BotChatQuestions'
import { useBotCredentials } from '../../components/channels/useBotCredentials'
import { t } from '../../i18n'

import { DismissQuestionButton } from './DismissQuestionButton'

import type { DecisionAnswer } from '../../api/agent-chat-types'
import type { AgentInputRequest } from '../../api/agent-types'

/**
 * One open question, with what the agent wrote to decide it from. A choice or
 * an answer typed on the card answers it, which wakes the agent that asked; no
 * message is sent. Dismissing withdraws it unanswered. A secret is the
 * secure card the conversation and a Bot's chat draw, which sends only where the
 * value was saved. An integration is the Connect card, which selects it in the
 * asking conversation's credentials, and that answers it, for whoever may change
 * them.
 */
export function DecisionCard({
  teamId,
  sessionId,
  title,
  request,
  canManage,
  onAnswer,
  onOpenConversation,
}: {
  teamId: string
  sessionId: string
  title: string | undefined
  request: AgentInputRequest
  /** Whether the viewer may change the asking conversation's credentials. */
  canManage: boolean
  onAnswer: (answer: DecisionAnswer) => void
  onOpenConversation: () => void
}) {
  const connect = parseConnectRequest(request) !== null
  const credentials = useBotCredentials(teamId, connect && canManage ? sessionId : undefined)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-5 pt-4">
      <div className="flex items-center gap-2 text-[12px] text-tertiary">
        <span className="min-w-0 flex-1 truncate">{title || t('Untitled agent')}</span>
        <button type="button" onClick={onOpenConversation} className="shrink-0 hover:text-main">
          {t('Open agent conversation')}
        </button>
      </div>
      <section>
        <BotChatQuestion
          request={{ sessionId, title: title ?? '', inputRequest: request }}
          teamId={teamId}
          credentials={credentials}
          onAnswer={(answer) => onAnswer(answer)}
          fullBody
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
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
          <DismissQuestionButton
            teamId={teamId}
            sessionId={sessionId}
            requestId={request.id}
            className="ml-auto"
          />
        </div>
      </section>
    </div>
  )
}
